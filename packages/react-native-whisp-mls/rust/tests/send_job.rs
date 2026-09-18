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

struct Fixture {
    root: std::path::PathBuf,
    config: String,
    id: String,
    device: String,
}
impl Fixture {
    fn new(base: &str) -> Self {
        let root = std::env::temp_dir().join(new_id());
        fs::create_dir_all(root.join("conversations")).unwrap();
        fs::create_dir_all(root.join("packages")).unwrap();
        let device = new_id();
        let key = generate_storage_key();
        let client = MlsClient::new(device.clone()).unwrap();
        fs::write(
            root.join("device.json"),
            json!({"deviceId":device}).to_string(),
        )
        .unwrap();
        fs::write(
            root.join("identity.age"),
            encode_base64(client.export_state(key.clone()).unwrap()),
        )
        .unwrap();
        fs::write(root.join("capture"), b"private capture").unwrap();
        let config = json!({"root":root,"userId":"alice","deviceId":device,"storageKey":key,"cookie":"session=test","baseUrl":base,"uploadthingVersion":"7.7.4"}).to_string();
        Self {
            root,
            config,
            id: new_id(),
            device,
        }
    }
    fn enqueue(&self) {
        enqueue_send_job(self.config.clone(), json!({"id":self.id,"deviceId":self.device,"source":self.root.join("capture"),"kind":"photo","recipients":["bob"],"groupId":null}).to_string()).unwrap();
    }
    fn advance(&self) -> Value {
        serde_json::from_str(&advance_send_job(self.config.clone(), self.id.clone()).unwrap())
            .unwrap()
    }
    fn dir(&self) -> std::path::PathBuf {
        self.root.join("sends").join(&self.id)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
        let _ = fs::remove_file(format!("{}.lock", self.root.display()));
    }
}

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
    assert!(advance_send_job(f.config.clone(), f.id.clone()).is_err());
    assert_eq!(
        fs::read(f.dir().join("ciphertext.age")).unwrap(),
        ciphertext
    );
    pause_send_job(f.config.clone(), f.id.clone()).unwrap();
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

#[test]
fn native_send_recovers_accepted_append_without_a_second_application() {
    for self_send in [false, true] {
        recovered_send(self_send);
    }
}
fn recovered_send(self_send: bool) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let f = Fixture::new(&format!("http://{}", listener.local_addr().unwrap()));
    let conversation = new_id();
    let conversation_for_receive = conversation.clone();
    let operation = new_id();
    let receiver_id = new_id();
    let receiver = MlsClient::new(receiver_id.clone()).unwrap();
    let package = encode_base64(receiver.key_package().unwrap());
    let sender = MlsClient::restore_state(
        decode_base64(fs::read_to_string(f.root.join("identity.age")).unwrap()).unwrap(),
        serde_json::from_str::<Value>(&f.config).unwrap()["storageKey"]
            .as_str()
            .unwrap()
            .into(),
    )
    .unwrap();
    let mut roster = json!([
        {"deviceId":f.device,"userId":"alice","signatureKey":encode_base64(sender.signature_key().unwrap())},
        {"deviceId":receiver_id,"userId":"bob","signatureKey":encode_base64(receiver.signature_key().unwrap())}
    ]);
    if self_send {
        roster = json!([roster[0]]);
    }
    let retained_id = f.id.clone();
    let appended = Arc::new(Mutex::new(Vec::<Value>::new()));
    let requests = appended.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    let delivered = Arc::new(AtomicBool::new(false));
    let server_delivered = delivered.clone();
    listener.set_nonblocking(true).unwrap();
    let server = thread::spawn(move || {
        let mut revision = 0;
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
            let route = line
                .split_whitespace()
                .nth(1)
                .unwrap()
                .split('?')
                .next()
                .unwrap()
                .to_owned();
            let mut length = 0;
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some((key, value)) = line.split_once(':')
                    && key.eq_ignore_ascii_case("content-length")
                {
                    length = value.trim().parse().unwrap();
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let input: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
            let result = match route.as_str() {
                "/api/trpc/mls.register" => json!({"ok":true}),
                "/api/trpc/mls.prepare" => json!({"conversations":[{"id":conversation}]}),
                "/api/trpc/mls.sync" => {
                    json!({"conversation":{"revision":revision},"welcome":null,"events":[]})
                }
                "/api/trpc/mls.retainedMessages" => json!([retained_id]),
                "/api/trpc/mls.descriptorPublished" => json!(revision != 0),
                "/api/trpc/mls.begin" => {
                    json!({"operationId":operation,"members":roster,"packages":if self_send { json!([]) } else { json!([{
                        "deviceId":receiver_id,"userId":"bob","signatureKey":roster[1]["signatureKey"],"keyPackageId":new_id(),"data":package
                    }]) }})
                }
                "/api/trpc/mls.append" => {
                    requests.lock().unwrap().push(input["json"].clone());
                    revision = if self_send { 2 } else { 3 };
                    // Commit was accepted, but the connection dies before its response.
                    continue;
                }
                "/api/trpc/mls.settle" => json!({"revision":revision}),
                "/api/uploadthing" => {
                    json!([{"url":"https://upload.example.test/signed-ciphertext"}])
                }
                "/api/trpc/mls.uploadStatus" => {
                    json!({"status":if server_delivered.load(Ordering::SeqCst) { "sent" } else { "pending" }})
                }
                _ => panic!("unexpected route: {route}"),
            };
            let body = if route == "/api/uploadthing" {
                result
            } else {
                json!({"result":{"data":{"json":result}}})
            }
            .to_string();
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", body.len(), body).unwrap();
        }
    });
    f.enqueue();
    fs::write(f.dir().join("compressed"), b"private media").unwrap();
    f.advance();
    f.advance();
    assert!(advance_send_job(f.config.clone(), f.id.clone()).is_err());
    assert_eq!(f.advance()["stage"], "continue");
    if self_send {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let descriptors: Value = serde_json::from_str(
            &runtime
                .block_on(sync_native_conversation(
                    f.config.clone(),
                    conversation_for_receive.clone(),
                ))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(descriptors[&f.id]["messageId"], f.id);
    }
    fs::copy(
        f.dir().join("ciphertext.age"),
        f.root.join("verification.age"),
    )
    .unwrap();
    assert_eq!(f.advance()["stage"], "continue"); // authorize upload
    assert_eq!(f.advance()["stage"], "upload");
    complete_send_upload(f.config.clone(), f.id.clone(), true).unwrap();
    assert_eq!(f.advance()["stage"], "confirm"); // bytes uploaded is not delivery
    assert!(f.dir().join("ciphertext.age").exists());
    delivered.store(true, Ordering::SeqCst);
    assert_eq!(f.advance()["stage"], "continue");
    assert_eq!(f.advance()["stage"], "sent");
    assert!(!f.dir().join("ciphertext.age").exists());
    acknowledge_send_job(f.config.clone(), f.id.clone()).unwrap();
    assert_eq!(list_send_jobs(f.config.clone()).unwrap(), "[]");
    stop.store(true, Ordering::SeqCst);
    server.join().unwrap();
    let appended = appended.lock().unwrap();
    assert_eq!(appended.len(), 1);
    if self_send {
        return;
    }
    let request = &appended[0];
    receiver
        .join_group(
            decode_base64(request["commits"][0]["welcome"].as_str().unwrap().into()).unwrap(),
        )
        .unwrap();
    receiver
        .process(decode_base64(request["commits"][1]["data"].as_str().unwrap().into()).unwrap())
        .unwrap();
    let ReceivedMessage::Application { plaintext, .. } = receiver
        .process(decode_base64(request["ciphertext"].as_str().unwrap().into()).unwrap())
        .unwrap()
    else {
        panic!("expected descriptor")
    };
    let descriptor: Value = serde_json::from_slice(&plaintext).unwrap();
    assert_eq!(descriptor["messageId"], f.id);
    decrypt_attachment_sync(
        f.root
            .join("verification.age")
            .to_string_lossy()
            .into_owned(),
        f.root.join("received").to_string_lossy().into_owned(),
        descriptor["key"].as_str().unwrap().into(),
    )
    .unwrap();
    assert_eq!(fs::read(f.root.join("received")).unwrap(), b"private media");
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
