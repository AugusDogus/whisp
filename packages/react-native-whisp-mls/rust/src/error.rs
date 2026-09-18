#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum MlsError {
    #[error("Invalid {field}. {requirement}")]
    InvalidInput { field: String, requirement: String },
    #[error("This client already belongs to a group. Create a separate client for another group.")]
    AlreadyJoined,
    #[error("This client has no group. Create a group or process a Welcome first.")]
    NotJoined,
    #[error(
        "The device is not a member of this group. Refresh the member list before removing it."
    )]
    MemberNotFound,
    #[error("The MLS session lock is poisoned. Restore the last durable session state and retry.")]
    SessionUnavailable,
    #[error("The send server could not be reached. Retry when connected.")]
    Transport,
    #[error("Send request {operation} failed ({status}). {recovery}")]
    Request {
        operation: String,
        status: u16,
        recovery: String,
    },
    // Do not include library Debug output: it can contain sensitive protocol data.
    #[error("MLS {operation} failed. {recovery}")]
    Protocol { operation: String, recovery: String },
}

impl MlsError {
    pub(crate) fn protocol(operation: &str) -> Self {
        Self::Protocol {
            operation: operation.into(),
            recovery: "Check the message, membership, and delivery order before retrying.".into(),
        }
    }

    pub(crate) fn input(field: &str, requirement: &str) -> Self {
        Self::InvalidInput {
            field: field.into(),
            requirement: requirement.into(),
        }
    }
}
