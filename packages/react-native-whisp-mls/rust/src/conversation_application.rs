//! Application sends advance the sender ratchet durably before publication.
//! A rejected or lost request must never restore the pre-encryption snapshot.
use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

// Refresh this sender's contribution at least every 24 hours of active use or
// 100 consumed generations. Rejected attempts count too. Peer commits do not
// reset this policy, and older snapshots deliberately require one refresh.
const MAX_UPDATE_AGE_SECONDS: u64 = 24 * 60 * 60;
const MAX_SENT_GENERATIONS: u32 = 100;

pub(super) fn now() -> Result<u64, MlsError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_secs())
        .map_err(|_| MlsError::protocol("MLS key refresh clock"))
}

pub(super) fn can_send(state: &State) -> Result<bool, MlsError> {
    let now = now()?;
    Ok(state
        .last_key_update
        .is_some_and(|updated| now >= updated && now - updated < MAX_UPDATE_AGE_SECONDS)
        && state.sent_since_key_update < MAX_SENT_GENERATIONS)
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PendingApplication {
    epoch: u64,
    ciphertext: String,
    descriptor: Descriptor,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SentApplication {
    epoch: u64,
    ciphertext: String,
    message_id: String,
    group_id: Option<String>,
}

impl SentApplication {
    pub(super) fn verify(
        &self,
        client: &MlsClient,
        ciphertext: &str,
        message_id: &str,
        group_id: &Option<String>,
    ) -> Result<(), MlsError> {
        if self.epoch != client.epoch()?
            || self.ciphertext != ciphertext
            || self.message_id != message_id
            || self.group_id != *group_id
        {
            return Err(MlsError::protocol("durable own application verification"));
        }
        Ok(())
    }
}

pub(super) enum Outcome {
    Published { draft_id: String },
    Cancelled,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Publication {
    #[serde(rename_all = "camelCase")]
    Published {
        revision: u64,
        epoch: u64,
        retained_message_ids: Vec<String>,
    },
    Cancelled,
}

pub(super) fn stage(
    config: &SendConfig,
    id: &str,
    state: &State,
    descriptor: &Descriptor,
) -> Result<(State, PendingApplication), MlsError> {
    let client = restore(config, &state.snapshot)?;
    verify(&client, id, &state.members)?;
    if !descriptor.valid()
        || descriptor.sender_id != config.user_id
        || !state
            .members
            .iter()
            .any(|member| member.device_id == config.device_id && member.user_id == config.user_id)
    {
        return Err(MlsError::protocol(
            "outgoing application identity validation",
        ));
    }
    let pending = PendingApplication {
        epoch: client.epoch()?,
        ciphertext: encode_base64(
            client.encrypt(
                serde_json::to_vec(descriptor)
                    .map_err(|_| MlsError::protocol("descriptor encoding"))?,
            )?,
        ),
        descriptor: descriptor.clone(),
    };
    let mut advanced = state.clone();
    advanced.snapshot = encode_base64(client.export_state(config.storage_key.clone())?);
    advanced.sent_since_key_update = advanced.sent_since_key_update.saturating_add(1);
    // One fsynced atomic rename stores both the exact request and its advanced
    // ratchet. No network operation is allowed before this checkpoint succeeds.
    save(
        config,
        id,
        &Record {
            current: Some(advanced.clone()),
            pending: Some(Pending::Application {
                application: pending.clone(),
            }),
        },
    )?;
    Ok((advanced, pending))
}

pub(super) fn publish(
    api: &Api,
    id: &str,
    mut current: State,
    pending: PendingApplication,
) -> Result<(State, Outcome), MlsError> {
    let result: Publication = api.call(
        "publishApplication",
        true,
        json!({
            "deviceId":api.config.device_id,
            "conversationId":id,
            "draftId":pending.descriptor.message_id,
            "epoch":pending.epoch,
            "ciphertext":pending.ciphertext,
        }),
    )?;
    let outcome = match result {
        Publication::Published {
            revision,
            epoch,
            retained_message_ids,
        } => {
            if epoch != pending.epoch
                || revision <= current.cursor
                || current
                    .outgoing
                    .last_key_value()
                    .is_some_and(|(sequence, _)| revision <= *sequence)
            {
                return Err(MlsError::protocol(
                    "accepted MLS application revision verification",
                ));
            }
            if revision == current.cursor + 1 {
                current.cursor = revision;
            } else {
                // Another sender published first in this epoch. Keep the
                // contiguous cursor until sync authenticates all intervening
                // events, matching our own echo against this saved ciphertext.
                current.outgoing.insert(
                    revision,
                    SentApplication {
                        epoch,
                        ciphertext: pending.ciphertext,
                        message_id: pending.descriptor.message_id.clone(),
                        group_id: pending.descriptor.group_id.clone(),
                    },
                );
            }
            let retained: HashSet<_> = retained_message_ids.into_iter().collect();
            if current
                .members
                .iter()
                .all(|member| member.user_id == api.config.user_id)
            {
                current.descriptors.insert(
                    pending.descriptor.message_id.clone(),
                    pending.descriptor.clone(),
                );
            }
            current
                .descriptors
                .retain(|message, _| retained.contains(message));
            Outcome::Published {
                draft_id: pending.descriptor.message_id,
            }
        }
        // Cancellation is an immutable server tombstone, not an HTTP conflict
        // that could be followed by a late successful copy of this request.
        Publication::Cancelled => Outcome::Cancelled,
    };
    save(
        api.config,
        id,
        &Record {
            current: Some(current.clone()),
            pending: None,
        },
    )?;
    Ok((current, outcome))
}
