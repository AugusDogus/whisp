//! Native sender uses the same versioned, encrypted records as foreground receives.
//! All entry points require the caller's cross-process device lease.
use crate::send_api::{Api, SendConfig};
use crate::{
    MlsClient, MlsError, ReceivedMessage, decode_base64, encode_base64, open_local, seal_local,
    write_private_file,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs};

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Member {
    device_id: String,
    user_id: String,
    signature_key: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Descriptor {
    pub version: u8,
    pub message_id: String,
    pub sender_id: String,
    pub group_id: Option<String>,
    pub key: String,
    pub mime_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbhash: Option<String>,
}
impl Descriptor {
    fn valid(&self) -> bool {
        self.version == 1
            && uuid::Uuid::parse_str(&self.message_id).is_ok()
            && !self.sender_id.is_empty()
            && !self.key.is_empty()
            && self.key.len() <= 256
            && matches!(self.mime_type.as_str(), "image/jpeg" | "video/mp4")
            && self.thumbhash.as_ref().is_none_or(|s| s.len() <= 256)
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct State {
    snapshot: String,
    cursor: u64,
    members: Vec<Member>,
    descriptors: BTreeMap<String, Descriptor>,
    #[serde(default)]
    welcome_key_package_id: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Pending {
    operation_id: String,
    next: State,
}
#[derive(Default, Deserialize, Serialize)]
struct Record {
    current: Option<State>,
    pending: Option<Pending>,
}
#[derive(Deserialize)]
struct Revision {
    revision: Option<u64>,
}
fn path(c: &SendConfig, id: &str) -> Result<String, MlsError> {
    uuid::Uuid::parse_str(id).map_err(|_| MlsError::protocol("conversation ID validation"))?;
    Ok(format!(
        "{}/conversations/{id}.age",
        c.root.trim_end_matches('/')
    ))
}
fn restore(c: &SendConfig, snapshot: &str) -> Result<MlsClient, MlsError> {
    MlsClient::restore_state(decode_base64(snapshot.into())?, c.storage_key.clone())
}
fn read(path: &str) -> Result<String, MlsError> {
    fs::read_to_string(path).map_err(|_| MlsError::protocol("conversation state read"))
}
fn save(c: &SendConfig, id: &str, record: &Record) -> Result<(), MlsError> {
    let json = serde_json::to_string(record)
        .map_err(|_| MlsError::protocol("conversation state encoding"))?;
    write_private_file(
        path(c, id)?,
        encode_base64(seal_local(json, c.storage_key.clone())?),
    )
}
fn pin(c: &SendConfig, roster: &[Member]) -> Result<(), MlsError> {
    #[derive(Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    struct Pin {
        user_id: String,
        signature_key: String,
    }
    for member in roster {
        uuid::Uuid::parse_str(&member.device_id)
            .map_err(|_| MlsError::protocol("member device ID validation"))?;
        let path = format!(
            "{}/peer-{}.json",
            c.root.trim_end_matches('/'),
            member.device_id
        );
        let expected = Pin {
            user_id: member.user_id.clone(),
            signature_key: member.signature_key.clone(),
        };
        if std::path::Path::new(&path).exists() {
            let actual: Pin = serde_json::from_str(&read(&path)?)
                .map_err(|_| MlsError::protocol("device identity pin decoding"))?;
            if actual != expected {
                return Err(MlsError::protocol("device identity pin verification"));
            }
        } else {
            write_private_file(
                path,
                serde_json::to_string(&expected)
                    .map_err(|_| MlsError::protocol("device identity pin encoding"))?,
            )?;
        }
    }
    Ok(())
}
fn verify(client: &MlsClient, id: &str, roster: &[Member]) -> Result<(), MlsError> {
    let actual = client.members()?;
    let distinct: std::collections::HashSet<_> = actual.iter().map(|m| &m.device_id).collect();
    if client.group_id()? != id.as_bytes()
        || actual.len() != roster.len()
        || distinct.len() != actual.len()
        || actual.iter().any(|m| {
            !roster.iter().any(|r| {
                r.device_id == m.device_id
                    && r.signature_key == encode_base64(m.signature_key.clone())
            })
        })
    {
        return Err(MlsError::protocol("authorized MLS membership verification"));
    }
    Ok(())
}
fn retire(api: &Api, id: &str, current: &mut State) -> Result<(), MlsError> {
    if let Some(key) = &current.welcome_key_package_id {
        uuid::Uuid::parse_str(key).map_err(|_| MlsError::protocol("Welcome key ID validation"))?;
        let path = format!(
            "{}/packages/{key}.age",
            api.config.root.trim_end_matches('/')
        );
        match fs::remove_file(path) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err(MlsError::protocol("Welcome private key retirement")),
        }
        api.call::<Value>(
            "acknowledgeWelcome",
            true,
            json!({"deviceId":api.config.device_id,"keyPackageId":key}),
        )?;
        current.welcome_key_package_id = None;
        save(
            api.config,
            id,
            &Record {
                current: Some(current.clone()),
                pending: None,
            },
        )?;
    }
    Ok(())
}
fn recover(api: &Api, id: &str) -> Result<Option<State>, MlsError> {
    let path = path(api.config, id)?;
    if !std::path::Path::new(&path).exists() {
        return Ok(None);
    }
    let mut record: Record = serde_json::from_str(&open_local(
        decode_base64(read(&path)?)?,
        api.config.storage_key.clone(),
    )?)
    .map_err(|_| MlsError::protocol("conversation state decoding"))?;
    if let Some(pending) = record.pending.take() {
        let result: Revision = api.call(
            "settle",
            true,
            json!({"deviceId":api.config.device_id,"operationId":pending.operation_id}),
        )?;
        if let Some(revision) = result.revision {
            if revision != pending.next.cursor {
                return Err(MlsError::protocol("pending MLS revision verification"));
            }
            record.current = Some(pending.next);
        }
        save(api.config, id, &record)?;
    }
    if let Some(current) = &mut record.current {
        retire(api, id, current)?;
    }
    Ok(record.current)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Welcome {
    key_package_id: String,
    sequence: u64,
    members: Vec<Member>,
    data: String,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Entry {
    Commit {
        data: String,
        members: Vec<Member>,
    },
    #[serde(rename_all = "camelCase")]
    Application {
        data: String,
        sender_device_id: String,
        sender_id: String,
        message_id: String,
        group_id: Option<String>,
    },
}
#[derive(Deserialize)]
struct Event {
    sequence: u64,
    entry: Entry,
}
#[derive(Deserialize)]
struct ConversationRevision {
    revision: u64,
}
#[derive(Deserialize)]
struct Sync {
    conversation: ConversationRevision,
    welcome: Option<Welcome>,
    events: Vec<Event>,
}
fn sync(api: &Api, id: &str) -> Result<Option<State>, MlsError> {
    let c = api.config;
    let mut state = recover(api, id)?;
    loop {
        let result: Sync = api.call("sync", false, json!({"deviceId":c.device_id,"conversationId":id,"after":state.as_ref().map_or(0, |s| s.cursor)}))?;
        if state
            .as_ref()
            .is_some_and(|s| result.conversation.revision < s.cursor)
        {
            return Err(MlsError::protocol("MLS history rollback detection"));
        }
        if state.is_none() && result.conversation.revision == 0 {
            return Ok(None);
        }
        if let Some(welcome) = result.welcome {
            uuid::Uuid::parse_str(&welcome.key_package_id)
                .map_err(|_| MlsError::protocol("Welcome ID validation"))?;
            let client = restore(
                c,
                &read(&format!(
                    "{}/packages/{}.age",
                    c.root.trim_end_matches('/'),
                    welcome.key_package_id
                ))?,
            )?;
            client.join_group(decode_base64(welcome.data)?)?;
            pin(c, &welcome.members)?;
            verify(&client, id, &welcome.members)?;
            let mut current = State {
                snapshot: encode_base64(client.export_state(c.storage_key.clone())?),
                cursor: welcome.sequence,
                members: welcome.members,
                descriptors: state.map_or_else(BTreeMap::new, |s| s.descriptors),
                welcome_key_package_id: Some(welcome.key_package_id),
            };
            save(
                c,
                id,
                &Record {
                    current: Some(current.clone()),
                    pending: None,
                },
            )?;
            retire(api, id, &mut current)?;
            state = Some(current);
        }
        let mut current =
            state.ok_or_else(|| MlsError::protocol("missing private conversation state"))?;
        let client = restore(c, &current.snapshot)?;
        let empty = result.events.is_empty();
        for event in result.events {
            if event.sequence != current.cursor + 1 {
                return Err(MlsError::protocol("MLS event sequence verification"));
            }
            match event.entry {
                Entry::Commit { data, members } => {
                    if !matches!(
                        client.process(decode_base64(data)?)?,
                        ReceivedMessage::GroupUpdated { .. }
                    ) {
                        return Err(MlsError::protocol("active MLS commit verification"));
                    }
                    pin(c, &members)?;
                    verify(&client, id, &members)?;
                    current.members = members;
                }
                Entry::Application {
                    data,
                    sender_device_id,
                    sender_id,
                    message_id,
                    group_id,
                } => {
                    let ReceivedMessage::Application { sender, plaintext } =
                        client.process(decode_base64(data)?)?
                    else {
                        return Err(MlsError::protocol("MLS application verification"));
                    };
                    if sender != sender_device_id
                        || !current
                            .members
                            .iter()
                            .any(|m| m.device_id == sender && m.user_id == sender_id)
                    {
                        return Err(MlsError::protocol("MLS sender authentication"));
                    }
                    if let Ok(d) = serde_json::from_slice::<Descriptor>(&plaintext)
                        && d.valid()
                        && d.sender_id == sender_id
                        && d.message_id == message_id
                        && d.group_id == group_id
                    {
                        current.descriptors.insert(message_id, d);
                    }
                }
            }
            current.cursor = event.sequence;
        }
        current.snapshot = encode_base64(client.export_state(c.storage_key.clone())?);
        save(
            c,
            id,
            &Record {
                current: Some(current.clone()),
                pending: None,
            },
        )?;
        if current.cursor >= result.conversation.revision {
            let retained: Vec<String> = api.call(
                "retainedMessages",
                false,
                json!({"deviceId":c.device_id,"conversationId":id}),
            )?;
            current.descriptors.retain(|key, _| retained.contains(key));
            save(
                c,
                id,
                &Record {
                    current: Some(current.clone()),
                    pending: None,
                },
            )?;
            return Ok(Some(current));
        }
        if empty {
            return Err(MlsError::protocol("incomplete MLS event log"));
        }
        state = Some(current);
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Package {
    device_id: String,
    user_id: String,
    signature_key: String,
    key_package_id: String,
    data: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Operation {
    operation_id: String,
    members: Vec<Member>,
    packages: Vec<Package>,
}

pub(crate) fn send(api: &Api, id: &str, descriptor: &Descriptor) -> Result<(), MlsError> {
    let c = api.config;
    let current = sync(api, id)?;
    // Receipt query comes AFTER recovery, including accepted requests whose response was lost.
    let published: bool = api.call(
        "descriptorPublished",
        false,
        json!({"deviceId":c.device_id,"draftId":descriptor.message_id,"conversationId":id}),
    )?;
    if published {
        return Ok(());
    }
    let operation: Operation = api.call("begin", true, json!({"deviceId":c.device_id,"conversationId":id,"revision":current.as_ref().map_or(0, |s| s.cursor)}))?;
    pin(c, &operation.members)?;
    let client = match &current {
        Some(s) => restore(c, &s.snapshot)?,
        None => restore(
            c,
            &read(&format!("{}/identity.age", c.root.trim_end_matches('/')))?,
        )?,
    };
    if current.is_none() {
        client.create_group(id.as_bytes().to_vec())?;
    }
    let mut roster = current.as_ref().map_or_else(
        || {
            operation
                .members
                .iter()
                .filter(|m| m.device_id == c.device_id)
                .cloned()
                .collect()
        },
        |s| s.members.clone(),
    );
    let mut commits = Vec::new();
    let mut welcomes = Vec::new();
    for member in roster.clone() {
        if operation
            .members
            .iter()
            .any(|m| m.device_id == member.device_id)
        {
            continue;
        }
        let data = encode_base64(client.remove_member(member.device_id.clone())?);
        roster.retain(|m| m.device_id != member.device_id);
        commits.push(json!({"data":data,"members":roster}));
    }
    if !operation.packages.is_empty() {
        let invitation = client.add_members(
            operation
                .packages
                .iter()
                .map(|p| decode_base64(p.data.clone()))
                .collect::<Result<_, _>>()?,
        )?;
        for p in &operation.packages {
            roster.push(Member {
                device_id: p.device_id.clone(),
                user_id: p.user_id.clone(),
                signature_key: p.signature_key.clone(),
            });
            welcomes.push(json!({"keyPackageId":p.key_package_id,"commitIndex":commits.len()}));
        }
        verify(&client, id, &roster)?;
        commits.push(json!({"data":encode_base64(invitation.commit),"members":roster,"welcome":encode_base64(invitation.welcome)}));
    }
    verify(&client, id, &operation.members)?;
    commits.push(json!({"data":encode_base64(client.update_keys()?),"members":operation.members}));
    let ciphertext = encode_base64(client.encrypt(
        serde_json::to_vec(descriptor).map_err(|_| MlsError::protocol("descriptor encoding"))?,
    )?);
    let mut descriptors = current
        .as_ref()
        .map_or_else(BTreeMap::new, |s| s.descriptors.clone());
    if operation.members.iter().all(|m| m.user_id == c.user_id) {
        descriptors.insert(descriptor.message_id.clone(), descriptor.clone());
    }
    let next = State {
        snapshot: encode_base64(client.export_state(c.storage_key.clone())?),
        cursor: current.as_ref().map_or(0, |s| s.cursor) + commits.len() as u64 + 1,
        members: operation.members,
        descriptors,
        welcome_key_package_id: None,
    };
    save(
        c,
        id,
        &Record {
            current,
            pending: Some(Pending {
                operation_id: operation.operation_id.clone(),
                next: next.clone(),
            }),
        },
    )?;
    let result: Revision = api.call("append", true, json!({"deviceId":c.device_id,"operationId":operation.operation_id,"draftId":descriptor.message_id,"commits":commits,"welcomes":welcomes,"ciphertext":ciphertext}))?;
    if result.revision != Some(next.cursor) {
        return Err(MlsError::protocol("accepted MLS revision verification"));
    }
    save(
        c,
        id,
        &Record {
            current: Some(next),
            pending: None,
        },
    )
}

/// The caller holds its device lease, shared with native sends, across this call.
#[uniffi::export(async_runtime = "tokio")]
pub async fn sync_native_conversation(
    config: String,
    conversation_id: String,
) -> Result<String, MlsError> {
    tokio::task::spawn_blocking(move || {
        let config = SendConfig::parse(&config)?;
        let current = sync(&Api::new(&config)?, &conversation_id)?;
        serde_json::to_string(&current.map(|s| s.descriptors))
            .map_err(|_| MlsError::protocol("received descriptor encoding"))
    })
    .await
    .map_err(|_| MlsError::protocol("conversation synchronization worker"))?
}
/// The caller holds its device lease, including when a receipt races a native send.
#[uniffi::export(async_runtime = "tokio")]
pub async fn forget_native_descriptor(
    config: String,
    conversation_id: String,
    message_id: String,
) -> Result<(), MlsError> {
    tokio::task::spawn_blocking(move || {
        let config = SendConfig::parse(&config)?;
        let api = Api::new(&config)?;
        if let Some(mut current) = recover(&api, &conversation_id)? {
            current.descriptors.remove(&message_id);
            save(
                &config,
                &conversation_id,
                &Record {
                    current: Some(current),
                    pending: None,
                },
            )?;
        }
        Ok(())
    })
    .await
    .map_err(|_| MlsError::protocol("descriptor retirement worker"))?
}
