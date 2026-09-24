use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};
use whisp_mls::*;

#[path = "support/send_fixture.rs"]
mod fixture;
use fixture::{Fixture, replace_phase};

#[test]
fn interrupted_preparation_retains_one_ciphertext_and_removes_plaintext() {
    let f = Fixture::new("http://127.0.0.1:1");
    f.enqueue();
    fs::remove_file(f.root.join("capture")).unwrap();
    assert_eq!(f.advance()["stage"], "compress");
    assert_eq!(
        fs::read(f.dir().join("source")).unwrap(),
        b"private capture"
    );
    // Native compressor atomically publishes this file. An interrupted partial is ignored.
    fs::write(f.dir().join("compressed.partial"), b"incomplete").unwrap();
    assert_eq!(f.advance()["stage"], "compress");
    fs::write(f.dir().join("compressed"), b"normalized jpeg").unwrap();
    assert_eq!(f.advance()["stage"], "continue");
    fs::write(f.dir().join("ciphertext.age"), b"interrupted encryption").unwrap();
    assert_eq!(f.advance()["stage"], "continue");
    assert!(!f.dir().join("source").exists());
    assert!(!f.dir().join("compressed").exists());
    let ciphertext = fs::read(f.dir().join("ciphertext.age")).unwrap();
    assert_ne!(ciphertext, b"normalized jpeg");
    assert!(matches!(
        advance_send_job(f.config.clone(), f.id.clone()).unwrap(),
        SendStep::Paused {
            failure: SendFailure {
                disposition: SendDisposition::Retry,
                ..
            }
        }
    ));
    assert_eq!(
        fs::read(f.dir().join("ciphertext.age")).unwrap(),
        ciphertext
    );
    pause_send_job(f.config.clone(), f.id.clone(), SendInterruption::Transfer).unwrap();
    let jobs: Value = serde_json::from_str(&list_send_jobs(f.config.clone()).unwrap()).unwrap();
    assert_eq!(jobs[0]["status"], "uploading");
    assert!(jobs[0]["error"].is_string());
    // Observing an error cannot remove a retryable job or its ciphertext.
    acknowledge_send_job(f.config.clone(), f.id.clone()).unwrap();
    assert!(f.dir().join("job.age").exists());
}

#[tokio::test]
async fn foreground_and_background_leases_exclude_each_other() {
    let f = Fixture::new("http://127.0.0.1:1");
    let root = f.root.to_string_lossy().into_owned();
    let lease = acquire_device_lease(root.clone()).await.unwrap();
    let entered = Arc::new(AtomicBool::new(false));
    let observed = entered.clone();
    let waiter = tokio::spawn(async move {
        let second = acquire_device_lease(root).await.unwrap();
        observed.store(true, Ordering::SeqCst);
        second.release().unwrap();
    });
    std::thread::sleep(std::time::Duration::from_millis(25));
    assert!(!entered.load(Ordering::SeqCst));
    lease.release().unwrap();
    waiter.await.unwrap();
    assert!(entered.load(Ordering::SeqCst));
}

#[tokio::test]
async fn native_receive_resumes_welcome_retirement_without_replaying_welcome() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let f = Fixture::new(&format!("http://{}", listener.local_addr().unwrap()));
    let conversation = new_id();
    let key_id = new_id();
    let key = serde_json::from_str::<Value>(&f.config).unwrap()["storageKey"]
        .as_str()
        .unwrap()
        .to_owned();
    let recipient = MlsClient::restore_state(
        decode_base64(fs::read_to_string(f.root.join("identity.age")).unwrap()).unwrap(),
        key.clone(),
    )
    .unwrap();
    let package = recipient.key_package().unwrap();
    let key_path = f.root.join("packages").join(format!("{key_id}.age"));
    fs::write(
        &key_path,
        encode_base64(recipient.export_state(key).unwrap()),
    )
    .unwrap();
    let sender_id = new_id();
    let sender = MlsClient::new(sender_id.clone()).unwrap();
    sender
        .create_group(conversation.as_bytes().to_vec())
        .unwrap();
    let welcome = sender.add_member(package).unwrap().welcome;
    let roster = json!([
        {"deviceId":sender_id,"userId":"bob","signatureKey":encode_base64(sender.signature_key().unwrap())},
        {"deviceId":f.device,"userId":"alice","signatureKey":encode_base64(recipient.signature_key().unwrap())}
    ]);
    let cursors = Arc::new(Mutex::new(Vec::<u64>::new()));
    let observed = cursors.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    listener.set_nonblocking(true).unwrap();
    let retired_key_path = key_path.clone();
    let server = thread::spawn(move || {
        let mut failed = false;
        while !stopped.load(Ordering::SeqCst) {
            let (mut socket, _) = match listener.accept() {
                Ok(s) => s,
                Err(_) => {
                    thread::sleep(std::time::Duration::from_millis(1));
                    continue;
                }
            };
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let url = reqwest::Url::parse(&format!(
                "http://localhost{}",
                line.split_whitespace().nth(1).unwrap()
            ))
            .unwrap();
            let mut length = 0;
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some((name, value)) = line.split_once(':')
                    && name.eq_ignore_ascii_case("content-length")
                {
                    length = value.trim().parse().unwrap();
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let mut status = "200 OK";
            let result = match url.path() {
                "/api/trpc/mls.sync" => {
                    let (_, input) = url.query_pairs().find(|(name, _)| name == "input").unwrap();
                    let after = serde_json::from_str::<Value>(&input).unwrap()["json"]["after"]
                        .as_u64()
                        .unwrap();
                    observed.lock().unwrap().push(after);
                    json!({"conversation":{"revision":1},"events":[],"welcome":if after == 0 { json!({"sequence":1,"keyPackageId":key_id,"members":roster,"data":encode_base64(welcome.clone())}) } else { Value::Null }})
                }
                "/api/trpc/mls.acknowledgeWelcome" => {
                    assert!(!retired_key_path.exists());
                    if !failed {
                        failed = true;
                        status = "503 Service Unavailable";
                    }
                    json!({"ok":true})
                }
                "/api/trpc/mls.retainedMessages" => json!([]),
                _ => panic!("unexpected request"),
            };
            let body = json!({"result":{"data":{"json":result}}}).to_string();
            write!(socket, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", body.len(), body).unwrap();
        }
    });
    assert!(
        sync_native_conversation(f.config.clone(), conversation.clone())
            .await
            .is_err()
    );
    // A crash/filesystem interruption can also leave retirement itself unfinished.
    fs::create_dir(&key_path).unwrap();
    assert!(
        sync_native_conversation(f.config.clone(), conversation.clone())
            .await
            .is_err()
    );
    fs::remove_dir(&key_path).unwrap();
    assert_eq!(
        sync_native_conversation(f.config.clone(), conversation.clone())
            .await
            .unwrap(),
        "{}"
    );
    stop.store(true, Ordering::SeqCst);
    server.join().unwrap();
    assert_eq!(*cursors.lock().unwrap(), [0, 1]);
}

#[test]
fn recovery_removes_plaintext_from_an_interrupted_enqueue() {
    let f = Fixture::new("http://127.0.0.1:1");
    fs::create_dir_all(f.dir()).unwrap();
    fs::write(f.dir().join("source"), b"abandoned plaintext").unwrap();
    assert_eq!(list_send_jobs(f.config.clone()).unwrap(), "[]");
    assert!(!f.dir().exists());
}

#[test]
fn expired_uploads_reconcile_missing_server_drafts_and_cleanup() {
    for phase in [
        json!({"stage":"upload","url":"https://upload.example.test"}),
        json!({"stage":"confirm"}),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let f = Fixture::new(&format!("http://{}", listener.local_addr().unwrap()));
        f.enqueue();
        replace_phase(&f, phase, 0);
        fs::write(f.dir().join("ciphertext.age"), b"ciphertext").unwrap();
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert!(line.contains("mls.uploadStatus"));
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
            }
            write!(
                socket,
                "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
        });
        assert_eq!(f.advance()["stage"], "failed");
        server.join().unwrap();
        assert!(!f.dir().join("ciphertext.age").exists());
        let jobs: Value = serde_json::from_str(&list_send_jobs(f.config.clone()).unwrap()).unwrap();
        assert_eq!(jobs[0]["status"], "failed");
        assert!(jobs[0]["error"].as_str().unwrap().contains("expired"));
    }
}

#[tokio::test]
async fn recovery_does_not_remove_an_enqueue_that_owns_its_job_lock() {
    let f = Fixture::new("http://127.0.0.1:1");
    fs::create_dir_all(f.root.join("sends")).unwrap();
    let lease = acquire_device_lease(f.dir().to_string_lossy().into_owned())
        .await
        .unwrap();
    fs::create_dir_all(f.dir()).unwrap();
    fs::write(f.dir().join("source"), b"copy in progress").unwrap();
    assert_eq!(list_send_jobs(f.config.clone()).unwrap(), "[]");
    assert!(f.dir().join("source").exists());
    lease.release().unwrap();
    list_send_jobs(f.config.clone()).unwrap();
    assert!(!f.dir().exists());
}

fn respond_once(listener: TcpListener, status: u16, value: Value) -> thread::JoinHandle<()> {
    let body = value.to_string();
    let length = body.len();
    respond_body_once(listener, status, body, length)
}

fn respond_body_once(
    listener: TcpListener,
    status: u16,
    body: String,
    content_length: usize,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(socket.try_clone().unwrap());
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
        }
        write!(socket, "HTTP/1.1 {status} Result\r\nContent-Type: application/json\r\nContent-Length: {content_length}\r\nConnection: close\r\n\r\n{body}").unwrap();
    })
}

#[test]
fn interrupted_response_body_retries_without_explicit_resume() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let f = Fixture::new(&format!("http://{}", listener.local_addr().unwrap()));
    f.enqueue();
    replace_phase(&f, json!({"stage":"confirm"}), u64::MAX);
    let retry_listener = listener.try_clone().unwrap();
    let server = respond_body_once(listener, 200, "{\"result\":".into(), 1000);
    assert_eq!(f.advance()["failure"]["disposition"], "retry");
    server.join().unwrap();
    let server = respond_once(
        retry_listener,
        200,
        json!({"result":{"data":{"json":{"status":"sent"}}}}),
    );
    assert_eq!(f.advance()["stage"], "continue");
    assert_eq!(f.advance()["stage"], "sent");
    server.join().unwrap();
}

#[test]
fn malformed_complete_response_still_requires_explicit_resume() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let f = Fixture::new(&format!("http://{}", listener.local_addr().unwrap()));
    f.enqueue();
    replace_phase(&f, json!({"stage":"confirm"}), u64::MAX);
    let body = "invalid JSON".to_owned();
    let length = body.len();
    let server = respond_body_once(listener, 200, body, length);
    assert_eq!(f.advance()["failure"]["disposition"], "blocked");
    server.join().unwrap();
    assert_eq!(f.advance()["failure"]["disposition"], "blocked");
}

#[test]
fn interrupted_upload_reconciles_delivery_before_reauthorizing_or_expiring() {
    for created_at in [0, u64::MAX] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let f = Fixture::new(&format!("http://{}", listener.local_addr().unwrap()));
        f.enqueue();
        replace_phase(
            &f,
            json!({"stage":"upload","url":"https://upload.example.test"}),
            created_at,
        );
        fs::write(f.dir().join("ciphertext.age"), b"ciphertext").unwrap();
        // The server accepted the upload, but the platform lost its response.
        complete_send_upload(f.config.clone(), f.id.clone(), false).unwrap();
        pause_send_job(f.config.clone(), f.id.clone(), SendInterruption::Transfer).unwrap();
        let server = respond_once(
            listener,
            200,
            json!({"result":{"data":{"json":{"status":"sent"}}}}),
        );
        assert_eq!(f.advance()["stage"], "continue");
        assert_eq!(f.advance()["stage"], "sent");
        server.join().unwrap();
        assert!(!f.dir().join("ciphertext.age").exists());
    }
}

#[test]
fn blocked_send_preserves_recovery_reason_and_waits_for_explicit_retry() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let f = Fixture::new(&format!("http://{}", listener.local_addr().unwrap()));
    f.enqueue();
    let current = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    replace_phase(&f, json!({"stage":"confirm"}), current);
    let reason =
        "A member device has no unused encryption keys. Ask them to open whisp, then retry.";
    let server = respond_once(
        listener,
        412,
        json!({"error":{"json":{"message":reason,"data":{"code":"PRECONDITION_FAILED"}}}}),
    );
    assert_eq!(f.advance()["failure"]["disposition"], "blocked");
    server.join().unwrap();
    // The server is gone. Automatic advances must not call it again.
    assert_eq!(f.advance()["failure"]["message"], reason);
    let jobs: Value = serde_json::from_str(&list_send_jobs(f.config.clone()).unwrap()).unwrap();
    assert_eq!(jobs[0]["status"], "blocked");
    assert_eq!(jobs[0]["error"], reason);
    acknowledge_send_job(f.config.clone(), f.id.clone()).unwrap();
    assert!(f.dir().join("job.age").exists());
    retry_send_job(f.config.clone(), f.id.clone()).unwrap();
    assert_eq!(f.advance()["failure"]["disposition"], "retry");
}

#[test]
fn old_upload_reconciles_success_before_expiring_locally() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let f = Fixture::new(&format!("http://{}", listener.local_addr().unwrap()));
    f.enqueue();
    replace_phase(&f, json!({"stage":"confirm"}), 0);
    let server = respond_once(
        listener,
        200,
        json!({"result":{"data":{"json":{"status":"sent"}}}}),
    );
    assert_eq!(f.advance()["stage"], "continue");
    assert_eq!(f.advance()["stage"], "sent");
    server.join().unwrap();
}

#[test]
fn compression_failure_preserves_source_until_retry_or_expiry() {
    let f = Fixture::new("http://127.0.0.1:1");
    f.enqueue();
    pause_send_job(
        f.config.clone(),
        f.id.clone(),
        SendInterruption::Compression,
    )
    .unwrap();
    assert_eq!(f.advance()["stage"], "paused");
    assert!(f.dir().join("source").exists());
    retry_send_job(f.config.clone(), f.id.clone()).unwrap();
    assert_eq!(f.advance()["stage"], "compress");
    replace_phase(&f, json!({"stage":"compress"}), 0);
    assert_eq!(f.advance()["stage"], "failed");
    assert!(!f.dir().join("source").exists());
}

#[test]
fn failed_enqueue_erases_the_unjournaled_source_copy() {
    let f = Fixture::new("http://127.0.0.1:1");
    let mut config: Value = serde_json::from_str(&f.config).unwrap();
    config["storageKey"] = json!("invalid key");
    let result = enqueue_send_job(
        config.to_string(),
        json!({
            "id": f.id, "deviceId": f.device, "source": f.root.join("capture"),
            "kind": "photo", "recipients": ["bob"], "groupId": null,
        })
        .to_string(),
    );
    assert!(result.is_err());
    assert!(!f.dir().exists());
    assert!(f.root.join("capture").exists());
}

#[test]
fn transient_server_failures_retry_without_exposing_internal_error_bodies() {
    for status in [409, 503] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let f = Fixture::new(&format!("http://{}", listener.local_addr().unwrap()));
        f.enqueue();
        replace_phase(&f, json!({"stage":"confirm"}), 0);
        let server = respond_once(
            listener,
            status,
            json!({"error":{"json":{"message":"INTERNAL_PRIVATE_DATA"}}}),
        );
        assert_eq!(f.advance()["failure"]["disposition"], "retry");
        server.join().unwrap();
        assert!(
            !list_send_jobs(f.config.clone())
                .unwrap()
                .contains("INTERNAL_PRIVATE_DATA")
        );
    }
}

#[test]
fn server_delivery_failure_reason_reaches_the_outbox() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let f = Fixture::new(&format!("http://{}", listener.local_addr().unwrap()));
    f.enqueue();
    replace_phase(&f, json!({"stage":"confirm"}), 0);
    let reason = "Recipient devices changed while uploading. Send the whisp again.";
    let server = respond_once(
        listener,
        200,
        json!({"result":{"data":{"json":{"status":"failed","message":reason}}}}),
    );
    assert_eq!(f.advance()["stage"], "continue");
    assert_eq!(f.advance()["message"], reason);
    server.join().unwrap();
    let jobs: Value = serde_json::from_str(&list_send_jobs(f.config.clone()).unwrap()).unwrap();
    assert_eq!(jobs[0]["error"], reason);
}

#[test]
fn expired_fresh_authorization_cleans_up_without_contacting_the_server() {
    let f = Fixture::new("http://127.0.0.1:1");
    f.enqueue();
    replace_phase(&f, json!({"stage":"authorizeFresh"}), 0);
    fs::write(f.dir().join("ciphertext.age"), b"expired ciphertext").unwrap();
    assert_eq!(f.advance()["stage"], "failed");
    assert!(!f.dir().join("ciphertext.age").exists());
    assert!(!f.dir().join("source").exists());
    assert!(f.dir().join("job.age").exists());
}
