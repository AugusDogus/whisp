//! The age v1 file format supplies authenticated, bounded-memory streaming,
//! including truncation detection. Plaintext is published only after EOF verifies.
use crate::MlsError;
use age::{secrecy::ExposeSecret, x25519};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::Path,
};

#[uniffi::export]
pub fn generate_storage_key() -> String {
    x25519::Identity::generate()
        .to_string()
        .expose_secret()
        .to_string()
}

pub(crate) fn seal(input: &[u8], key: &str) -> Result<Vec<u8>, MlsError> {
    let identity = identity(key)?;
    let recipient = identity.to_public();
    let encryptor =
        age::Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))
            .map_err(|_| MlsError::protocol("storage encryption setup"))?;
    let mut out = Vec::new();
    let mut writer = encryptor
        .wrap_output(&mut out)
        .map_err(|_| MlsError::protocol("storage encryption"))?;
    writer
        .write_all(input)
        .map_err(|_| MlsError::protocol("storage encryption"))?;
    writer
        .finish()
        .map_err(|_| MlsError::protocol("storage encryption finalization"))?;
    Ok(out)
}

pub(crate) fn open(input: &[u8], key: &str) -> Result<Vec<u8>, MlsError> {
    let identity = identity(key)?;
    let decryptor =
        age::Decryptor::new(input).map_err(|_| MlsError::protocol("storage decoding"))?;
    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|_| MlsError::protocol("storage authentication"))?;
    let mut out = Vec::new();
    reader
        .read_to_end(&mut out)
        .map_err(|_| MlsError::protocol("storage authentication"))?;
    Ok(out)
}

fn identity(key: &str) -> Result<x25519::Identity, MlsError> {
    key.parse()
        .map_err(|_| MlsError::input("storage key", "Expected an age X25519 identity."))
}

fn output(path: &str) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// Creates a new ciphertext file. The returned key belongs only inside MLS ciphertext.
pub fn encrypt_attachment_sync(
    input_path: String,
    output_path: String,
) -> Result<String, MlsError> {
    let key = generate_storage_key();
    let identity = identity(&key)?;
    let recipient = identity.to_public();
    let mut input = File::open(input_path).map_err(|_| MlsError::protocol("attachment read"))?;
    let mut out =
        output(&output_path).map_err(|_| MlsError::protocol("attachment output creation"))?;
    let result = (|| {
        let encryptor =
            age::Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))
                .map_err(|_| MlsError::protocol("attachment encryption setup"))?;
        let mut writer = encryptor
            .wrap_output(&mut out)
            .map_err(|_| MlsError::protocol("attachment encryption"))?;
        io::copy(&mut input, &mut writer)
            .map_err(|_| MlsError::protocol("attachment encryption"))?;
        writer
            .finish()
            .map_err(|_| MlsError::protocol("attachment encryption finalization"))?;
        out.sync_all()
            .map_err(|_| MlsError::protocol("attachment flush"))?;
        Ok(key)
    })();
    if result.is_err() {
        let _ = fs::remove_file(output_path);
    }
    result
}

pub fn decrypt_attachment_sync(
    input_path: String,
    output_path: String,
    key: String,
) -> Result<(), MlsError> {
    let identity = identity(&key)?;
    if Path::new(&output_path).exists() {
        return Err(MlsError::input(
            "output path",
            "Use a new private temporary file.",
        ));
    }
    let input = File::open(input_path).map_err(|_| MlsError::protocol("attachment read"))?;
    let decryptor = age::Decryptor::new(io::BufReader::new(input))
        .map_err(|_| MlsError::protocol("attachment decoding"))?;
    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|_| MlsError::protocol("attachment authentication"))?;
    let temporary = format!("{output_path}.partial");
    let mut out =
        output(&temporary).map_err(|_| MlsError::protocol("temporary attachment creation"))?;
    let result = (|| {
        // age rejects modified chunks, reordered chunks, and a missing final chunk.
        io::copy(&mut reader, &mut out)
            .map_err(|_| MlsError::protocol("attachment authentication"))?;
        out.sync_all()
            .map_err(|_| MlsError::protocol("decrypted attachment flush"))?;
        fs::rename(&temporary, output_path)
            .map_err(|_| MlsError::protocol("decrypted attachment publication"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn encrypt_attachment(
    input_path: String,
    output_path: String,
) -> Result<String, MlsError> {
    tokio::task::spawn_blocking(move || encrypt_attachment_sync(input_path, output_path))
        .await
        .map_err(|_| MlsError::protocol("attachment worker"))?
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn decrypt_attachment(
    input_path: String,
    output_path: String,
    key: String,
) -> Result<(), MlsError> {
    tokio::task::spawn_blocking(move || decrypt_attachment_sync(input_path, output_path, key))
        .await
        .map_err(|_| MlsError::protocol("attachment worker"))?
}

#[uniffi::export]
pub fn encode_base64(bytes: Vec<u8>) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}
#[uniffi::export]
pub fn decode_base64(text: String) -> Result<Vec<u8>, MlsError> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .map_err(|_| MlsError::input("base64", "Invalid binary encoding."))
}
#[uniffi::export]
pub fn utf8_encode(text: String) -> Vec<u8> {
    text.into_bytes()
}
#[uniffi::export]
pub fn utf8_decode(bytes: Vec<u8>) -> Result<String, MlsError> {
    String::from_utf8(bytes).map_err(|_| MlsError::input("UTF-8", "Invalid text encoding."))
}
#[uniffi::export]
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
#[uniffi::export]
pub fn seal_local(text: String, key: String) -> Result<Vec<u8>, MlsError> {
    seal(text.as_bytes(), &key)
}
#[uniffi::export]
pub fn open_local(bytes: Vec<u8>, key: String) -> Result<String, MlsError> {
    utf8_decode(open(&bytes, &key)?)
}

/// Durable replacement: flush file contents, rename atomically, then flush the
/// directory before publishing public keys or accepting an MLS log position.
#[uniffi::export]
pub fn write_private_file(path: String, text: String) -> Result<(), MlsError> {
    let temporary = format!("{path}.{}.tmp", uuid::Uuid::new_v4());
    let mut file = output(&temporary).map_err(|_| MlsError::protocol("private state creation"))?;
    let result = (|| {
        file.write_all(text.as_bytes())
            .map_err(|_| MlsError::protocol("private state write"))?;
        file.sync_all()
            .map_err(|_| MlsError::protocol("private state flush"))?;
        fs::rename(&temporary, &path)
            .map_err(|_| MlsError::protocol("private state replacement"))?;
        if let Some(parent) = Path::new(&path).parent() {
            File::open(parent)
                .and_then(|directory| directory.sync_all())
                .map_err(|_| MlsError::protocol("private state directory flush"))?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
