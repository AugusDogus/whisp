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
    kind: MediaKind,
    recipients: Vec<String>,
    group_id: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(tag = "stage", rename_all = "camelCase")]
enum Phase {
    Compress,
    Encrypt,
    Publish { descriptor: Descriptor },
    // No transfer has been handed to a platform worker yet. Retried transfers
    // use Authorize, whose status check reconciles ambiguous upload outcomes.
    AuthorizeFresh,
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
    failure: Option<SendFailure>,
    id: String,
    kind: MediaKind,
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
    fs::create_dir_all(Path::new(&c.root).join("sends"))
        .map_err(|_| MlsError::protocol("send queue creation"))?;
    let _job = DeviceLease::acquire(&dir.to_string_lossy())?;
    fs::create_dir_all(&dir).map_err(|_| MlsError::protocol("send directory creation"))?;
    {
        let _device = DeviceLease::acquire(&c.root)?;
        check_device(&c)?;
    }
    if dir.join("job.age").exists() {
        return Ok(input.id);
    }
    let result = (|| {
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
        std::io::copy(&mut source, &mut target)
            .map_err(|_| MlsError::protocol("queued media copy"))?;
        target
            .flush()
            .and_then(|()| target.sync_all())
            .map_err(|_| MlsError::protocol("queued media flush"))?;
        let job = Job {
            created_at: now()?,
            failure: None,
            id: input.id,
            kind: input.kind,
            recipients: input.recipients,
            group_id: input.group_id,
            phase: Phase::Compress,
        };
        save(&c, &job)?;
        Ok(job.id)
    })();
    if result.is_err() && !dir.join("job.age").exists() {
        fs::remove_dir_all(&dir).map_err(|_| MlsError::protocol("incomplete send cleanup"))?;
    }
    result
}

/// One checkpoint per call permits OS expiration/cancellation between phases.
/// Compression completion uses a flushed, atomically renamed `compressed` file.
#[uniffi::export]
pub fn advance_send_job(config: String, id: String) -> Result<SendStep, MlsError> {
    let c = SendConfig::parse(&config)?;
    let dir = directory(&c, &id)?;
    let _job = DeviceLease::acquire(&dir.to_string_lossy())?;
    let mut job = read(&c, &id)?;
    let expired = now()?.saturating_sub(job.created_at) > 86_400_000;
    // Reauthorization also follows interrupted uploads, whose response may be
    // lost after delivery. Reconcile these before retrying or expiring locally.
    if expired
        && !matches!(
            job.phase,
            Phase::Authorize
                | Phase::Upload { .. }
                | Phase::Confirm
                | Phase::Sent
                | Phase::Failed { .. }
        )
    {
        job.phase = Phase::Failed {
            message: "This queued whisp expired after 24 hours. Capture and send it again.".into(),
        };
        job.failure = None;
        save(&c, &job)?;
    }
    if !expired
        && let Some(failure) = &job.failure
        && failure.disposition == SendDisposition::Blocked
    {
        return Ok(SendStep::Paused {
            failure: failure.clone(),
        });
    }
    if job.failure.take().is_some() {
        save(&c, &job)?;
    }
    match advance(&c, &mut job, expired) {
        Ok(step) => Ok(step),
        Err(error) => record_failure(&c, &mut job, SendFailure::from_error(error)),
    }
}

fn record_failure(
    c: &SendConfig,
    job: &mut Job,
    failure: SendFailure,
) -> Result<SendStep, MlsError> {
    if failure.disposition == SendDisposition::Terminal {
        job.phase = Phase::Failed {
            message: failure.message.clone(),
        };
        job.failure = None;
        save(c, job)?;
        cleanup(&directory(c, &job.id)?)?;
        Ok(SendStep::Failed {
            message: failure.message,
        })
    } else {
        job.failure = Some(failure.clone());
        save(c, job)?;
        Ok(SendStep::Paused { failure })
    }
}

fn advance(c: &SendConfig, job: &mut Job, expired: bool) -> Result<SendStep, MlsError> {
    let id = job.id.clone();
    let dir = directory(c, &id)?;
    match &job.phase {
        Phase::Sent => {
            cleanup(&dir)?;
            return Ok(SendStep::Sent);
        }
        Phase::Failed { message } => {
            cleanup(&dir)?;
            return Ok(SendStep::Failed {
                message: message.clone(),
            });
        }
        _ => (),
    }
    let api = Api::new(c)?;
    match &job.phase {
        Phase::Compress if dir.join("compressed").is_file() => job.phase = Phase::Encrypt,
        Phase::Compress => {
            return Ok(SendStep::Compress {
                kind: job.kind,
                source: dir.join("source").to_string_lossy().into_owned(),
                output: dir.join("compressed").to_string_lossy().into_owned(),
            });
        }
        Phase::Encrypt => {
            // An interrupted encryption has no published descriptor, so discard it.
            remove(&dir.join("ciphertext.age"))?;
            let key = encrypt_attachment_sync(
                dir.join("compressed").to_string_lossy().into_owned(),
                dir.join("ciphertext.age").to_string_lossy().into_owned(),
            )?;
            job.phase = Phase::Publish {
                descriptor: Descriptor {
                    version: 1,
                    message_id: id.clone(),
                    sender_id: c.user_id.clone(),
                    group_id: job.group_id.clone(),
                    key,
                    mime_type: match job.kind {
                        MediaKind::Photo => "image/jpeg",
                        MediaKind::Video => "video/mp4",
                    }
                    .into(),
                    thumbhash: None,
                },
            };
        }
        Phase::Publish { descriptor } => {
            // The same OS lock guards foreground receives, provisioning and reset.
            let _device = DeviceLease::acquire(&c.root)?;
            check_device(c)?;
            let identity = MlsClient::restore_state(
                decode_base64(
                    fs::read_to_string(Path::new(&c.root).join("identity.age"))
                        .map_err(|_| MlsError::protocol("send identity read"))?,
                )?,
                c.storage_key.clone(),
            )?;
            let signature_key = encode_base64(identity.signature_key()?);
            #[derive(Deserialize)]
            struct Conversation {
                id: String,
            }
            #[derive(Deserialize)]
            struct Prepared {
                conversations: Vec<Conversation>,
                #[serde(default, rename = "deviceIdentityValidated")]
                device_identity_validated: bool,
                #[serde(default, rename = "supportsAtomicBegin")]
                supports_atomic_begin: bool,
            }
            let mut input =
                json!({"deviceId":c.device_id,"draftId":id,"signatureKey":signature_key});
            if let Some(group) = &job.group_id {
                input["groupId"] = json!(group);
            } else {
                input["recipients"] = json!(job.recipients);
            }
            let prepared: Prepared = match api.call("prepare", true, input.clone()) {
                // Older servers ignore signatureKey. Unregistered devices need
                // the former registration sequence; revocations still fail.
                Err(MlsError::Request { status: 412, .. }) => {
                    api.call::<Value>(
                        "register",
                        true,
                        json!({"deviceId":c.device_id,"signatureKey":signature_key}),
                    )?;
                    api.call("prepare", true, input)?
                }
                result => result?,
            };
            if !prepared.device_identity_validated {
                // Old prepare responses do not validate the supplied key. Keep
                // the former identity check before publishing any descriptor.
                api.call::<Value>(
                    "register",
                    true,
                    json!({"deviceId":c.device_id,"signatureKey":signature_key}),
                )?;
            }
            for conversation in prepared.conversations {
                conversation::send(
                    &api,
                    &conversation.id,
                    descriptor,
                    prepared.supports_atomic_begin,
                )?;
            }
            job.phase = Phase::AuthorizeFresh;
        }
        Phase::AuthorizeFresh => {
            let size = fs::metadata(dir.join("ciphertext.age"))
                .map_err(|_| MlsError::protocol("ciphertext metadata read"))?
                .len();
            job.phase = Phase::Upload {
                url: api.presign(&id, size)?,
            };
        }
        Phase::Authorize | Phase::Upload { .. } | Phase::Confirm => {
            #[derive(Deserialize)]
            #[serde(tag = "status", rename_all = "lowercase")]
            enum DeliveryStatus {
                Sent,
                Pending,
                Failed { message: String },
            }
            let status: DeliveryStatus = api.call("uploadStatus", false, json!({"draftId":id}))?;
            match status {
                DeliveryStatus::Sent => job.phase = Phase::Sent,
                DeliveryStatus::Failed { message } => job.phase = Phase::Failed { message },
                DeliveryStatus::Pending if expired => {
                    return record_failure(
                        c,
                        job,
                        SendFailure {
                            disposition: SendDisposition::Terminal,
                            message: "This queued upload expired. Capture and send it again."
                                .into(),
                        },
                    );
                }
                DeliveryStatus::Pending if matches!(job.phase, Phase::Authorize) => {
                    let size = fs::metadata(dir.join("ciphertext.age"))
                        .map_err(|_| MlsError::protocol("ciphertext metadata read"))?
                        .len();
                    job.phase = Phase::Upload {
                        url: api.presign(&id, size)?,
                    };
                }
                DeliveryStatus::Pending => {
                    return Ok(match &job.phase {
                        Phase::Upload { url } => SendStep::Upload {
                            transfer: SendUpload {
                                url: url.clone(),
                                file: dir.join("ciphertext.age").to_string_lossy().into_owned(),
                                id,
                            },
                        },
                        _ => SendStep::Confirm,
                    });
                }
            }
        }
        Phase::Sent | Phase::Failed { .. } => {
            unreachable!("terminal phases handled before network setup")
        }
    }
    save(c, job)?;
    // Erase plaintext as soon as the encrypted checkpoint is durable.
    if !matches!(job.phase, Phase::Compress | Phase::Encrypt) {
        remove(&dir.join("source"))?;
        remove(&dir.join("compressed"))?;
        remove(&dir.join("compressed.partial"))?;
    }
    // Return a newly authorized transfer immediately, after making it durable.
    // It does not need another uploadStatus round trip. A
    // restarted worker still enters Phase::Upload above and rechecks delivery.
    if let Phase::Upload { url } = &job.phase {
        return Ok(SendStep::Upload {
            transfer: SendUpload {
                url: url.clone(),
                file: dir.join("ciphertext.age").to_string_lossy().into_owned(),
                id,
            },
        });
    }
    Ok(SendStep::Continue)
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
pub fn send_job_statuses(config: String) -> Result<Vec<SendJobStatus>, MlsError> {
    let c = SendConfig::parse(&config)?;
    let root = Path::new(&c.root).join("sends");
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut jobs = Vec::new();
    for entry in fs::read_dir(root).map_err(|_| MlsError::protocol("send queue read"))? {
        let entry = entry.map_err(|_| MlsError::protocol("send queue entry read"))?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if uuid::Uuid::parse_str(&id).is_err() {
            continue;
        }
        if !entry.path().join("job.age").exists() {
            // Enqueue owns this same lock from before directory creation until
            // the journal is durable. Never delete a copy still in progress.
            if let Some(_lease) = DeviceLease::try_acquire(&entry.path().to_string_lossy())?
                && entry.path().exists()
                && !entry.path().join("job.age").exists()
            {
                fs::remove_dir_all(entry.path())
                    .map_err(|_| MlsError::protocol("orphan send cleanup"))?;
            }
            continue;
        }
        let job = read(&c, &id)?;
        let (status, error) = match job.phase {
            Phase::Sent => (SendStatus::Sent, None),
            Phase::Failed { message } => (SendStatus::Failed, Some(message)),
            _ => match job.failure {
                Some(failure) => (
                    if failure.disposition == SendDisposition::Blocked {
                        SendStatus::Blocked
                    } else {
                        SendStatus::Uploading
                    },
                    Some(failure.message),
                ),
                None => (SendStatus::Uploading, None),
            },
        };
        jobs.push(SendJobStatus {
            id,
            kind: job.kind,
            recipients: job.recipients,
            group_id: job.group_id,
            status,
            error,
            created_at: job.created_at,
        });
    }
    jobs.sort_by_key(|job| job.created_at);
    Ok(jobs)
}

/// JSON is the Expo boundary only; native workers use generated records.
#[uniffi::export]
pub fn list_send_jobs(config: String) -> Result<String, MlsError> {
    serde_json::to_string(&send_job_statuses(config)?)
        .map_err(|_| MlsError::protocol("send status encoding"))
}

#[uniffi::export]
pub fn pause_send_job(
    config: String,
    id: String,
    reason: SendInterruption,
) -> Result<SendStep, MlsError> {
    let c = SendConfig::parse(&config)?;
    let dir = directory(&c, &id)?;
    let _job = DeviceLease::acquire(&dir.to_string_lossy())?;
    let mut job = read(&c, &id)?;
    record_failure(&c, &mut job, reason.into())
}

/// Explicit foreground recovery releases jobs that required user action.
#[uniffi::export]
pub fn retry_send_job(config: String, id: String) -> Result<(), MlsError> {
    let c = SendConfig::parse(&config)?;
    let dir = directory(&c, &id)?;
    let _job = DeviceLease::acquire(&dir.to_string_lossy())?;
    if !dir.join("job.age").exists() {
        return Ok(());
    }
    let mut job = read(&c, &id)?;
    job.failure = None;
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
