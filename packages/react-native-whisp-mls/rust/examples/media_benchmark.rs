//! Run with `cargo run --release --example media_benchmark` on the target hardware.
//! Includes durable file flushes. These are local IO/crypto timings, not send latency.
use std::{fs, time::Instant};
use whisp_mls::{decrypt_attachment_sync, encrypt_attachment_sync};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let directory = std::env::temp_dir().join(format!("whisp-bench-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&directory)?;
    let result = run(&directory);
    fs::remove_dir_all(directory)?;
    result
}

fn run(directory: &std::path::Path) -> Result<(), Box<dyn std::error::Error>> {
    let path = |name| directory.join(name).to_string_lossy().into_owned();
    for size_mb in [2, 20, 100] {
        let bytes = vec![0x5a; size_mb * 1024 * 1024];
        fs::write(path("input"), &bytes)?;
        let mut encrypt = Vec::new();
        let mut decrypt = Vec::new();
        for iteration in 0..6 {
            let start = Instant::now();
            let key = encrypt_attachment_sync(path("input"), path("encrypted"))?;
            let encrypted = start.elapsed();
            let start = Instant::now();
            decrypt_attachment_sync(path("encrypted"), path("decrypted"), key)?;
            let decrypted = start.elapsed();
            if iteration > 0 {
                encrypt.push(encrypted);
                decrypt.push(decrypted);
            }
            assert_eq!(fs::read(path("decrypted"))?, bytes);
            fs::remove_file(path("encrypted"))?;
            fs::remove_file(path("decrypted"))?;
        }
        encrypt.sort();
        decrypt.sort();
        println!(
            "{size_mb} MiB median: encrypt {:.2} ms, decrypt {:.2} ms",
            encrypt[2].as_secs_f64() * 1000.0,
            decrypt[2].as_secs_f64() * 1000.0
        );
    }
    Ok(())
}
