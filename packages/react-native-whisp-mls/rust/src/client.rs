use std::sync::{Mutex, MutexGuard};

use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::OpenMlsProvider;
use tls_codec::{Deserialize, Serialize};

use crate::MlsError;

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
const MAX_WIRE_BYTES: usize = 1024 * 1024;
const MAX_PLAINTEXT_BYTES: usize = 64 * 1024;

#[derive(uniffi::Record)]
pub struct Invitation {
    /// Deliver to existing members before subsequent application messages.
    pub commit: Vec<u8>,
    /// Deliver only to the newly added device.
    pub welcome: Vec<u8>,
}

#[derive(Debug, PartialEq, uniffi::Enum)]
pub enum ReceivedMessage {
    Application { sender: String, plaintext: Vec<u8> },
    GroupUpdated { epoch: u64 },
    Removed,
}

struct State {
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
    group: Option<MlsGroup>,
}

/// A persistent MLS group, restored from authenticated encrypted storage.
/// Callers stage mutations durably before compare-and-append to the delivery log.
#[derive(uniffi::Object)]
pub struct MlsClient {
    state: Mutex<State>,
}

#[uniffi::export]
impl MlsClient {
    #[uniffi::constructor]
    pub fn new(device_id: String) -> Result<Self, MlsError> {
        if device_id.trim().is_empty() || device_id.len() > 128 {
            return Err(MlsError::input("device ID", "Use 1 to 128 UTF-8 bytes."));
        }
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm())
            .map_err(|_| MlsError::protocol("signature key generation"))?;
        let credential = CredentialWithKey {
            credential: BasicCredential::new(device_id.into_bytes()).into(),
            signature_key: signer.to_public_vec().into(),
        };
        Ok(Self {
            state: Mutex::new(State {
                provider: OpenMlsRustCrypto::default(),
                signer,
                credential,
                group: None,
            }),
        })
    }

    pub fn signature_key(&self) -> Result<Vec<u8>, MlsError> {
        Ok(self.lock()?.signer.to_public_vec())
    }

    /// The provider includes secret trees, ratchets, and pending KeyPackages.
    pub fn export_state(&self, storage_key: String) -> Result<Vec<u8>, MlsError> {
        let state = self.lock()?;
        let storage = state
            .provider
            .storage()
            .values
            .read()
            .map_err(|_| MlsError::SessionUnavailable)?;
        let snapshot = IdentitySnapshot {
            group_id: state
                .group
                .as_ref()
                .map(|g| g.group_id().as_slice().to_vec()),
            signer: &state.signer,
            credential: &state.credential,
            storage: storage
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        };
        let bytes = zeroize::Zeroizing::new(
            serde_json::to_vec(&snapshot).map_err(|_| MlsError::protocol("identity encoding"))?,
        );
        crate::attachment::seal(&bytes, &storage_key)
    }

    #[uniffi::constructor]
    pub fn restore_state(snapshot: Vec<u8>, storage_key: String) -> Result<Self, MlsError> {
        if snapshot.len() > 4 * MAX_WIRE_BYTES {
            return Err(MlsError::input("snapshot", "Maximum size is 4 MiB."));
        }
        let bytes = zeroize::Zeroizing::new(crate::attachment::open(&snapshot, &storage_key)?);
        let saved: SavedIdentity =
            serde_json::from_slice(&bytes).map_err(|_| MlsError::protocol("identity decoding"))?;
        let provider = OpenMlsRustCrypto::default();
        *provider
            .storage()
            .values
            .write()
            .map_err(|_| MlsError::SessionUnavailable)? = saved.storage.into_iter().collect();
        let group = match saved.group_id {
            Some(id) => Some(
                MlsGroup::load(provider.storage(), &GroupId::from_slice(&id))
                    .map_err(|_| MlsError::protocol("group state loading"))?
                    .ok_or_else(|| MlsError::protocol("missing group state"))?,
            ),
            None => None,
        };
        Ok(Self {
            state: Mutex::new(State {
                provider,
                signer: saved.signer,
                credential: saved.credential,
                group,
            }),
        })
    }

    pub fn members(&self) -> Result<Vec<DeviceCredential>, MlsError> {
        let state = self.lock()?;
        let group = state.group.as_ref().ok_or(MlsError::NotJoined)?;
        group
            .members()
            .map(|m| {
                let credential = BasicCredential::try_from(m.credential)
                    .map_err(|_| MlsError::protocol("member credential"))?;
                Ok(DeviceCredential {
                    device_id: String::from_utf8(credential.identity().to_vec())
                        .map_err(|_| MlsError::protocol("member identity"))?,
                    signature_key: m.signature_key,
                })
            })
            .collect()
    }

    pub fn group_id(&self) -> Result<Vec<u8>, MlsError> {
        Ok(self
            .lock()?
            .group
            .as_ref()
            .ok_or(MlsError::NotJoined)?
            .group_id()
            .as_slice()
            .to_vec())
    }

    /// Fresh update path before every send gives recovery after a compromise and
    /// fresh encryption secrets if a staged send loses the server revision race.
    pub fn update_keys(&self) -> Result<Vec<u8>, MlsError> {
        let mut state = self.lock()?;
        let State {
            provider,
            signer,
            group,
            ..
        } = &mut *state;
        let group = group.as_mut().ok_or(MlsError::NotJoined)?;
        let bundle = group
            .self_update(provider, signer, LeafNodeParameters::default())
            .map_err(|_| MlsError::protocol("self update"))?;
        let commit = encode(bundle.commit())?;
        group
            .merge_pending_commit(provider)
            .map_err(|_| MlsError::protocol("self update merge"))?;
        Ok(commit)
    }

    pub fn key_package(&self) -> Result<Vec<u8>, MlsError> {
        let state = self.lock()?;
        let bundle = KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &state.provider,
                &state.signer,
                state.credential.clone(),
            )
            .map_err(|_| MlsError::protocol("key package generation"))?;
        encode(&MlsMessageOut::from(bundle.key_package().clone()))
    }

    pub fn create_group(&self, group_id: Vec<u8>) -> Result<(), MlsError> {
        if group_id.is_empty() || group_id.len() > 128 {
            return Err(MlsError::input("group ID", "Use 1 to 128 bytes."));
        }
        let mut state = self.lock()?;
        if state.group.is_some() {
            return Err(MlsError::AlreadyJoined);
        }
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
            .build();
        state.group = Some(
            MlsGroup::new_with_group_id(
                &state.provider,
                &state.signer,
                &config,
                GroupId::from_slice(&group_id),
                state.credential.clone(),
            )
            .map_err(|_| MlsError::protocol("group creation"))?,
        );
        Ok(())
    }

    pub fn add_member(&self, key_package: Vec<u8>) -> Result<Invitation, MlsError> {
        self.add_members(vec![key_package])
    }

    pub fn add_members(&self, key_packages: Vec<Vec<u8>>) -> Result<Invitation, MlsError> {
        if key_packages.is_empty() || key_packages.len() > 200 {
            return Err(MlsError::input(
                "members",
                "Add 1 to 200 devices at a time.",
            ));
        }
        let mut state = self.lock()?;
        let mut packages = Vec::with_capacity(key_packages.len());
        for bytes in key_packages {
            let MlsMessageBodyIn::KeyPackage(package) = decode(&bytes)?.extract() else {
                return Err(MlsError::input(
                    "key package",
                    "Expected an MLS KeyPackage message.",
                ));
            };
            packages.push(
                package
                    .validate(state.provider.crypto(), ProtocolVersion::Mls10)
                    .map_err(|_| MlsError::protocol("key package validation"))?,
            );
        }
        let State {
            provider,
            signer,
            group,
            ..
        } = &mut *state;
        let group = group.as_mut().ok_or(MlsError::NotJoined)?;
        let (commit, welcome, _) = group
            .add_members(provider, signer, &packages)
            .map_err(|_| MlsError::protocol("member addition"))?;
        let invitation = Invitation {
            commit: encode(&commit)?,
            welcome: encode(&welcome)?,
        };
        group
            .merge_pending_commit(provider)
            .map_err(|_| MlsError::protocol("add commit merge"))?;
        Ok(invitation)
    }

    pub fn join_group(&self, welcome: Vec<u8>) -> Result<(), MlsError> {
        let MlsMessageBodyIn::Welcome(welcome) = decode(&welcome)?.extract() else {
            return Err(MlsError::input(
                "welcome",
                "Expected an MLS Welcome message.",
            ));
        };
        let mut state = self.lock()?;
        if state.group.is_some() {
            return Err(MlsError::AlreadyJoined);
        }
        let config = MlsGroupJoinConfig::builder()
            .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
            .build();
        state.group = Some(
            StagedWelcome::new_from_welcome(&state.provider, &config, welcome, None)
                .map_err(|_| MlsError::protocol("Welcome validation"))?
                .into_group(&state.provider)
                .map_err(|_| MlsError::protocol("group join"))?,
        );
        Ok(())
    }

    pub fn encrypt(&self, plaintext: Vec<u8>) -> Result<Vec<u8>, MlsError> {
        if plaintext.len() > MAX_PLAINTEXT_BYTES {
            return Err(MlsError::input(
                "message",
                "Maximum size is 64 KiB. Encrypt attachments separately.",
            ));
        }
        let mut state = self.lock()?;
        let State {
            provider,
            signer,
            group,
            ..
        } = &mut *state;
        let group = group.as_mut().ok_or(MlsError::NotJoined)?;
        let message = group
            .create_message(provider, signer, &plaintext)
            .map_err(|_| MlsError::protocol("message encryption"))?;
        encode(&message)
    }

    pub fn process(&self, message: Vec<u8>) -> Result<ReceivedMessage, MlsError> {
        let message = decode(&message)?.try_into_protocol_message().map_err(|_| {
            MlsError::input("message", "Expected an MLS application message or commit.")
        })?;
        let mut state = self.lock()?;
        let State {
            provider, group, ..
        } = &mut *state;
        let group = group.as_mut().ok_or(MlsError::NotJoined)?;
        let processed = group
            .process_message(provider, message)
            .map_err(|_| MlsError::protocol("message authentication/decryption"))?;
        let credential = processed.credential().clone();
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(application) => {
                let basic = BasicCredential::try_from(credential)
                    .map_err(|_| MlsError::protocol("sender credential decoding"))?;
                let sender = String::from_utf8(basic.identity().to_vec())
                    .map_err(|_| MlsError::protocol("sender identity decoding"))?;
                Ok(ReceivedMessage::Application {
                    sender,
                    plaintext: application.into_bytes(),
                })
            }
            ProcessedMessageContent::StagedCommitMessage(commit) => {
                group
                    .merge_staged_commit(provider, *commit)
                    .map_err(|_| MlsError::protocol("received commit merge"))?;
                if group.is_active() {
                    Ok(ReceivedMessage::GroupUpdated {
                        epoch: group.epoch().as_u64(),
                    })
                } else {
                    Ok(ReceivedMessage::Removed)
                }
            }
            _ => Err(MlsError::input(
                "message",
                "Send proposals as ordered commits.",
            )),
        }
    }

    pub fn remove_member(&self, device_id: String) -> Result<Vec<u8>, MlsError> {
        let mut state = self.lock()?;
        let State {
            provider,
            signer,
            group,
            ..
        } = &mut *state;
        let group = group.as_mut().ok_or(MlsError::NotJoined)?;
        let indices: Vec<_> = group
            .members()
            .filter_map(|member| {
                BasicCredential::try_from(member.credential)
                    .ok()
                    .filter(|credential| credential.identity() == device_id.as_bytes())
                    .map(|_| member.index)
            })
            .collect();
        if indices.is_empty() {
            return Err(MlsError::MemberNotFound);
        }
        let (commit, _, _) = group
            .remove_members(provider, signer, &indices)
            .map_err(|_| MlsError::protocol("member removal"))?;
        let encoded = encode(&commit)?;
        group
            .merge_pending_commit(provider)
            .map_err(|_| MlsError::protocol("remove commit merge"))?;
        Ok(encoded)
    }
}

impl MlsClient {
    fn lock(&self) -> Result<MutexGuard<'_, State>, MlsError> {
        self.state.lock().map_err(|_| MlsError::SessionUnavailable)
    }
}

fn encode(message: &MlsMessageOut) -> Result<Vec<u8>, MlsError> {
    message
        .tls_serialize_detached()
        .map_err(|_| MlsError::protocol("wire encoding"))
}

fn decode(bytes: &[u8]) -> Result<MlsMessageIn, MlsError> {
    if bytes.is_empty() || bytes.len() > MAX_WIRE_BYTES {
        return Err(MlsError::input("MLS payload", "Expected 1 byte to 1 MiB."));
    }
    MlsMessageIn::tls_deserialize_exact(bytes).map_err(|_| {
        MlsError::input(
            "MLS payload",
            "The complete payload must be a valid MLS 1.0 message.",
        )
    })
}

#[derive(serde::Serialize)]
struct IdentitySnapshot<'a> {
    group_id: Option<Vec<u8>>,
    signer: &'a SignatureKeyPair,
    credential: &'a CredentialWithKey,
    storage: Vec<(Vec<u8>, Vec<u8>)>,
}

#[derive(serde::Deserialize)]
struct SavedIdentity {
    group_id: Option<Vec<u8>>,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
    storage: Vec<(Vec<u8>, Vec<u8>)>,
}

#[derive(uniffi::Record)]
pub struct DeviceCredential {
    pub device_id: String,
    pub signature_key: Vec<u8>,
}
