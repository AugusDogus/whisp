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
        Self::open(root, false)?.ok_or_else(|| MlsError::protocol("device lock acquisition"))
    }
    pub(crate) fn try_acquire(root: &str) -> Result<Option<Self>, MlsError> {
        Self::open(root, true)
    }
    fn open(root: &str, nonblocking: bool) -> Result<Option<Self>, MlsError> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(format!("{}.lock", root.trim_end_matches('/')))
            .map_err(|_| MlsError::protocol("device lock creation"))?;
        let result = if nonblocking {
            file.try_lock_exclusive()
        } else {
            file.lock_exclusive()
        };
        match result {
            Err(error) if nonblocking && error.kind() == std::io::ErrorKind::WouldBlock => {
                return Ok(None);
            }
            Err(_) => return Err(MlsError::protocol("device lock acquisition")),
            Ok(()) => (),
        }
        Ok(Some(Self {
            file: Mutex::new(Some(file)),
        }))
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
