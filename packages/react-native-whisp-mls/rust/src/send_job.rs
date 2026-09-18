//! Durable checkpoints, persisted before network side effects. Platform workers own
//! compression and background transfers; neither needs a running JavaScript VM.
use crate::{
    MlsError,
    conversation::{self, Descriptor},
    device_lock::DeviceLease,
    send_api::{Api, SendConfig},
    *,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    id: String,
    device_id: String,
    source: String,
    kind: Kind,
    recipients: Vec<String>,
    group_id: Option<String>,
}
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Kind {
    Photo,
    Video,
}
#[derive(Deserialize, Serialize)]
#[serde(tag = "stage", rename_all = "camelCase")]
enum Phase {
    Compress,
    Encrypt,
    Publish { descriptor: Descriptor },
    Authorize,
    Upload { url: String },
    Confirm,
    Sent,
    Failed { message: String },
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    created_at: u64,
    #[serde(default)]
    error: Option<String>,
    id: String,
    kind: Kind,
    recipients: Vec<String>,
    group_id: Option<String>,
    phase: Phase,
}
fn directory(c: &SendConfig, id: &str) -> Result<PathBuf, MlsError> {
    uuid::Uuid::parse_str(id).map_err(|_| MlsError::protocol("send job ID validation"))?;
    Ok(Path::new(&c.root).join("sends").join(id))
}
fn save(c: &SendConfig, job: &Job) -> Result<(), MlsError> {
    write_private_file(
        directory(c, &job.id)?
            .join("job.age")
            .to_string_lossy()
            .into_owned(),
        encode_base64(seal_local(
            serde_json::to_string(job).map_err(|_| MlsError::protocol("send journal encoding"))?,
            c.storage_key.clone(),
        )?),
    )
}
fn read(c: &SendConfig, id: &str) -> Result<Job, MlsError> {
    let data = fs::read_to_string(directory(c, id)?.join("job.age"))
        .map_err(|_| MlsError::protocol("send journal read"))?;
    serde_json::from_str(&open_local(decode_base64(data)?, c.storage_key.clone())?)
        .map_err(|_| MlsError::protocol("send journal validation"))
}
fn check_device(c: &SendConfig) -> Result<(), MlsError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Manifest {
        device_id: String,
    }
    let data = fs::read_to_string(Path::new(&c.root).join("device.json"))
        .map_err(|_| MlsError::protocol("send device manifest read"))?;
    let manifest: Manifest = serde_json::from_str(&data)
        .map_err(|_| MlsError::protocol("send device manifest decoding"))?;
    if manifest.device_id != c.device_id {
        return Err(MlsError::protocol("send device identity changed"));
    }
    Ok(())
}
fn remove(path: &Path) -> Result<(), MlsError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(MlsError::protocol("send media cleanup")),
    }
}
fn cleanup(dir: &Path) -> Result<(), MlsError> {
    for name in [
        "source",
        "compressed",
        "compressed.partial",
        "ciphertext.age",
        "multipart",
    ] {
        remove(&dir.join(name))?;
    }
    Ok(())
}
#[uniffi::export]
pub fn enqueue_send_job(config: String, input: String) -> Result<String, MlsError> {
    let c = SendConfig::parse(&config)?;
    let input: Input =
        serde_json::from_str(&input).map_err(|_| MlsError::protocol("send input decoding"))?;
    if input.recipients.len() > 100
        || (input.group_id.is_none() && input.recipients.is_empty())
        || !Path::new(&input.source).is_file()
    {
        return Err(MlsError::protocol("send input validation"));
    }
    if input.device_id != c.device_id {
        return Err(MlsError::protocol("send account changed before enqueue"));
    }
    let dir = directory(&c, &input.id)?;
    fs::create_dir_all(&dir).map_err(|_| MlsError::protocol("send directory creation"))?;
    let _job = DeviceLease::acquire(&dir.to_string_lossy())?;
    {
        let _device = DeviceLease::acquire(&c.root)?;
        check_device(&c)?;
    }
    if dir.join("job.age").exists() {
        return Ok(input.id);
    }
    // Capture owns a temporary file. Copy and flush before accepting the job.
    let mut source =
        fs::File::open(&input.source).map_err(|_| MlsError::protocol("captured media read"))?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut target = options
        .open(dir.join("source"))
        .map_err(|_| MlsError::protocol("queued media creation"))?;
    std::io::copy(&mut source, &mut target).map_err(|_| MlsError::protocol("queued media copy"))?;
    target
        .flush()
        .and_then(|()| target.sync_all())
        .map_err(|_| MlsError::protocol("queued media flush"))?;
    let job = Job {
        created_at: now()?,
        error: None,
        id: input.id,
        kind: input.kind,
        recipients: input.recipients,
        group_id: input.group_id,
        phase: Phase::Compress,
    };
    save(&c, &job)?;
    Ok(job.id)
}

/// One checkpoint per call permits OS expiration/cancellation between phases.
/// Compression completion uses a flushed, atomically renamed `compressed` file.
#[uniffi::export]
pub fn advance_send_job(config: String, id: String) -> Result<String, MlsError> {
    let c = SendConfig::parse(&config)?;
    let dir = directory(&c, &id)?;
    let _job = DeviceLease::acquire(&dir.to_string_lossy())?;
    let mut job = read(&c, &id)?;
    job.error = None;
    if matches!(
        job.phase,
        Phase::Compress | Phase::Encrypt | Phase::Publish { .. } | Phase::Authorize
    ) && now()?.saturating_sub(job.created_at) > 86_400_000
    {
        job.phase = Phase::Failed {
            message: "This queued whisp expired after 24 hours. Capture and send it again.".into(),
        };
        save(&c, &job)?;
    }
    let api = Api::new(&c)?;
    match &job.phase {
        Phase::Compress if dir.join("compressed").is_file() => job.phase = Phase::Encrypt,
        Phase::Compress => return Ok(json!({"stage":"compress","kind":job.kind,"source":dir.join("source"),"output":dir.join("compressed")}).to_string()),
        Phase::Encrypt => {
            // An interrupted encryption has no published descriptor, so discard it.
            remove(&dir.join("ciphertext.age"))?;
            let key = encrypt_attachment_sync(dir.join("compressed").to_string_lossy().into_owned(), dir.join("ciphertext.age").to_string_lossy().into_owned())?;
            job.phase = Phase::Publish { descriptor: Descriptor { version: 1, message_id: id.clone(), sender_id: c.user_id.clone(), group_id: job.group_id.clone(),
                key, mime_type: match job.kind { Kind::Photo => "image/jpeg", Kind::Video => "video/mp4" }.into(), thumbhash: None } };
        },
        Phase::Publish { descriptor } => {
            // The same OS lock guards foreground receives, provisioning and reset.
            let _device = DeviceLease::acquire(&c.root)?;
            check_device(&c)?;
            let identity = MlsClient::restore_state(decode_base64(fs::read_to_string(Path::new(&c.root).join("identity.age")).map_err(|_| MlsError::protocol("send identity read"))?)?, c.storage_key.clone())?;
            api.call::<Value>("register", true, json!({"deviceId":c.device_id,"signatureKey":encode_base64(identity.signature_key()?)}))?;
            #[derive(Deserialize)] struct Conversation { id: String }
            #[derive(Deserialize)] struct Prepared { conversations: Vec<Conversation> }
            let mut input = json!({"deviceId":c.device_id,"draftId":id});
            if let Some(group) = &job.group_id { input["groupId"] = json!(group); } else { input["recipients"] = json!(job.recipients); }
            let prepared: Prepared = api.call("prepare", true, input)?;
            for conversation in prepared.conversations { conversation::send(&api, &conversation.id, descriptor)?; }
            job.phase = Phase::Authorize;
        },
        Phase::Authorize => {
            let size = fs::metadata(dir.join("ciphertext.age")).map_err(|_| MlsError::protocol("ciphertext metadata read"))?.len();
            job.phase = Phase::Upload { url: api.presign(&id, size)? };
        },
        Phase::Upload { url } => {
            let status: Value = api.call("uploadStatus", false, json!({"draftId":id}))?;
            match status["status"].as_str() {
                Some("sent") => job.phase = Phase::Sent,
                Some("failed") => job.phase = Phase::Failed { message: "Delivery failed or expired. Send this whisp again.".into() },
                Some("pending") => return Ok(json!({"stage":"upload","url":url,"file":dir.join("ciphertext.age"),"id":id}).to_string()),
                _ => return Err(MlsError::protocol("delivery status validation")),
            }
        },
        Phase::Confirm => {
            let status: Value = api.call("uploadStatus", false, json!({"draftId":id}))?;
            match status["status"].as_str() {
                Some("sent") => job.phase = Phase::Sent,
                Some("failed") => job.phase = Phase::Failed { message: "Delivery failed or expired. Send this whisp again.".into() },
                Some("pending") => return Ok(json!({"stage":"confirm"}).to_string()),
                _ => return Err(MlsError::protocol("delivery status validation")),
            }
        },
        Phase::Sent | Phase::Failed { .. } => {
            cleanup(&dir)?;
            return serde_json::to_string(&job.phase).map_err(|_| MlsError::protocol("send status encoding"));
        },
    }
    save(&c, &job)?;
    // Erase plaintext as soon as the encrypted checkpoint is durable.
    if !matches!(job.phase, Phase::Compress | Phase::Encrypt) {
        remove(&dir.join("source"))?;
        remove(&dir.join("compressed"))?;
        remove(&dir.join("compressed.partial"))?;
    }
    Ok(json!({"stage":"continue"}).to_string())
}
#[uniffi::export]
pub fn complete_send_upload(config: String, id: String, success: bool) -> Result<(), MlsError> {
    let c = SendConfig::parse(&config)?;
    let dir = directory(&c, &id)?;
    let _job = DeviceLease::acquire(&dir.to_string_lossy())?;
    let mut job = read(&c, &id)?;
    if matches!(job.phase, Phase::Upload { .. }) {
        job.phase = if success {
            Phase::Confirm
        } else {
            Phase::Authorize
        };
        save(&c, &job)?;
    }
    Ok(())
}
#[uniffi::export]
pub fn list_send_jobs(config: String) -> Result<String, MlsError> {
    let c = SendConfig::parse(&config)?;
    let root = Path::new(&c.root).join("sends");
    if !root.exists() {
        return Ok("[]".into());
    }
    let mut jobs = Vec::new();
    for entry in fs::read_dir(root).map_err(|_| MlsError::protocol("send queue read"))? {
        let entry = entry.map_err(|_| MlsError::protocol("send queue entry read"))?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if uuid::Uuid::parse_str(&id).is_err() || !entry.path().join("job.age").exists() {
            continue;
        }
        let job = read(&c, &id)?;
        let status = match job.phase {
            Phase::Sent => "sent",
            Phase::Failed { .. } => "failed",
            _ => "uploading",
        };
        jobs.push(json!({"id":id,"kind":job.kind,"recipients":job.recipients,"groupId":job.group_id,"status":status,"error":job.error,"createdAt":job.created_at}));
    }
    jobs.sort_by_key(|j| j["createdAt"].as_u64().unwrap_or(0));
    Ok(Value::Array(jobs).to_string())
}

/// Record a bounded, non-sensitive failure without discarding its retry checkpoint.
#[uniffi::export]
pub fn pause_send_job(config: String, id: String) -> Result<(), MlsError> {
    let c = SendConfig::parse(&config)?;
    let dir = directory(&c, &id)?;
    let _job = DeviceLease::acquire(&dir.to_string_lossy())?;
    let mut job = read(&c, &id)?;
    job.error = Some("Sending is paused. Check your connection and sign-in. Whisp will retry; the queued media is preserved.".into());
    save(&c, &job)
}
#[uniffi::export]
pub fn acknowledge_send_job(config: String, id: String) -> Result<(), MlsError> {
    let c = SendConfig::parse(&config)?;
    let dir = directory(&c, &id)?;
    let _job = DeviceLease::acquire(&dir.to_string_lossy())?;
    if !dir.join("job.age").exists() {
        return Ok(());
    }
    let job = read(&c, &id)?;
    if matches!(job.phase, Phase::Sent | Phase::Failed { .. }) {
        cleanup(&dir)?;
        fs::remove_dir_all(dir).map_err(|_| MlsError::protocol("completed send cleanup"))?;
    }
    Ok(())
}

fn now() -> Result<u64, MlsError> {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| MlsError::protocol("send clock validation"))?
        .as_millis();
    u64::try_from(millis).map_err(|_| MlsError::protocol("send clock overflow"))
}
