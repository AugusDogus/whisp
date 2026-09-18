//! OS locks also coordinate separately loaded Rust libraries and background workers.
use crate::MlsError;
use fs2::FileExt;
use std::{
    fs::{File, OpenOptions},
    sync::{Arc, Mutex},
};

#[derive(uniffi::Object)]
pub struct DeviceLease {
    file: Mutex<Option<File>>,
}
impl DeviceLease {
    pub(crate) fn acquire(root: &str) -> Result<Self, MlsError> {
        // Outside the device directory: resetting the device must not replace the lock inode.
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(format!("{}.lock", root.trim_end_matches('/')))
            .map_err(|_| MlsError::protocol("device lock creation"))?;
        file.lock_exclusive()
            .map_err(|_| MlsError::protocol("device lock acquisition"))?;
        Ok(Self {
            file: Mutex::new(Some(file)),
        })
    }
}
#[uniffi::export]
impl DeviceLease {
    pub fn release(&self) -> Result<(), MlsError> {
        self.file
            .lock()
            .map_err(|_| MlsError::SessionUnavailable)?
            .take();
        Ok(())
    }
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn acquire_device_lease(root: String) -> Result<Arc<DeviceLease>, MlsError> {
    tokio::task::spawn_blocking(move || DeviceLease::acquire(&root).map(Arc::new))
        .await
        .map_err(|_| MlsError::protocol("device lock worker"))?
}
