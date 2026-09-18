mod attachment;
pub use attachment::*;
mod client;
mod device_lock;
pub use device_lock::*;
mod conversation;
pub use conversation::{forget_native_descriptor, sync_native_conversation};
mod send_api;
mod send_job;
pub use send_job::*;
mod error;

pub use client::{DeviceCredential, Invitation, MlsClient, ReceivedMessage};
pub use error::MlsError;

uniffi::setup_scaffolding!();
