use super::fixture::Fixture;
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

#[derive(Clone, Copy, PartialEq)]
pub enum Recipient {
    Peer,
    SelfOnly,
}
#[derive(Clone, Copy, PartialEq)]
pub enum Capabilities {
    Legacy,
    InlineIdentity,
    AtomicBegin,
    Applications,
}

#[derive(Default)]
pub struct Faults {
    pub conflict: AtomicBool,
    pub lose_append: AtomicBool,
    pub lose_application: AtomicBool,
    pub cancel_application: AtomicBool,
}

pub struct SendHarness {
    pub f: Fixture,
    pub conversation: String,
    pub receiver: MlsClient,
    pub appended: Arc<Mutex<Vec<Value>>>,
    pub applications: Arc<Mutex<Vec<Value>>>,
    pub routes: Arc<Mutex<Vec<String>>>,
    pub delivered: Arc<AtomicBool>,
    pub faults: Arc<Faults>,
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

impl SendHarness {
    pub fn new(recipient: Recipient, capabilities: Capabilities) -> Self {
        let self_send = recipient == Recipient::SelfOnly;
        let modern_server = capabilities != Capabilities::Legacy;
        let atomic_begin = matches!(
            capabilities,
            Capabilities::AtomicBegin | Capabilities::Applications
        );
        let applications_enabled = capabilities == Capabilities::Applications;
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
        let applications = Arc::new(Mutex::new(Vec::<Value>::new()));
        let server_applications = applications.clone();
        let routes = Arc::new(Mutex::new(Vec::<String>::new()));
        let server_routes = routes.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let delivered = Arc::new(AtomicBool::new(false));
        let server_delivered = delivered.clone();
        let faults = Arc::new(Faults::default());
        let server_faults = faults.clone();
        listener.set_nonblocking(true).unwrap();
        let server = thread::spawn(move || {
            let mut revision = 0;
            let mut application_revision = None;

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
                server_routes.lock().unwrap().push(route.clone());
                let result = match route.as_str() {
                    "/api/trpc/mls.register" => {
                        assert!(!modern_server, "Preparation already validated the device");
                        json!({"ok":true})
                    }
                    "/api/trpc/mls.prepare" => {
                        assert!(input["json"]["signatureKey"].is_string());
                        let mut response = json!({"conversations":[{"id":conversation}]});
                        if modern_server {
                            response["deviceIdentityValidated"] = json!(true);
                            response["supportsAtomicBegin"] = json!(atomic_begin);
                            response["supportsApplicationPublish"] = json!(applications_enabled);
                        }
                        response
                    }
                    "/api/trpc/mls.sync" => {
                        let mut response = json!({"conversation":{"revision":revision},"welcome":null,"events":[]});
                        if modern_server {
                            response["descriptorPublished"] = json!(revision != 0);
                        }
                        if self_send {
                            response["retainedMessageIds"] =
                                if server_delivered.load(Ordering::SeqCst) {
                                    json!([])
                                } else {
                                    json!([retained_id])
                                };
                        }
                        response
                    }
                    "/api/trpc/mls.retainedMessages" => {
                        assert!(!self_send, "Inline retention must not make another request");
                        json!([retained_id])
                    }
                    "/api/trpc/mls.descriptorPublished" => {
                        assert!(!modern_server, "Sync already returned the receipt");
                        json!(revision != 0)
                    }
                    "/api/trpc/mls.begin" | "/api/trpc/mls.beginSend" => {
                        assert_eq!(route.ends_with("beginSend"), atomic_begin);
                        if atomic_begin && server_faults.conflict.swap(false, Ordering::SeqCst) {
                            write!(socket, "HTTP/1.1 409 Conflict\r\nConnection: close\r\nContent-Length: 0\r\n\r\n").unwrap();
                            continue;
                        }
                        if atomic_begin && revision != 0 {
                            json!({"kind":"published", "retainedMessageIds":if self_send { json!([retained_id]) } else { json!([]) }})
                        } else {
                            let operation = json!({"operationId":operation,"members":roster,"packages":if self_send { json!([]) } else { json!([{
                            "deviceId":receiver_id,"userId":"bob","signatureKey":roster[1]["signatureKey"],"keyPackageId":new_id(),"data":package
                        }]) }});
                            if atomic_begin {
                                json!({"kind":"operation","operation":operation,"retainedMessageIds":[]})
                            } else {
                                operation
                            }
                        }
                    }
                    "/api/trpc/mls.append" => {
                        requests.lock().unwrap().push(input["json"].clone());
                        revision = if self_send { 2 } else { 3 };
                        if server_faults.lose_append.swap(false, Ordering::SeqCst) {
                            // Commit was accepted, but the connection dies before its response.
                            continue;
                        }
                        json!({"revision":revision})
                    }
                    "/api/trpc/mls.publishApplication" => {
                        assert!(applications_enabled);
                        server_applications
                            .lock()
                            .unwrap()
                            .push(input["json"].clone());
                        if server_faults
                            .cancel_application
                            .swap(false, Ordering::SeqCst)
                        {
                            json!({"kind":"cancelled"})
                        } else {
                            if application_revision.is_none() {
                                revision += 1;
                                application_revision = Some(revision);
                                if server_faults.lose_application.swap(false, Ordering::SeqCst) {
                                    continue; // Accepted, but its response was lost.
                                }
                            }
                            json!({"kind":"published","revision":application_revision.unwrap(),"epoch":input["json"]["epoch"],"retainedMessageIds":[input["json"]["draftId"]]})
                        }
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
        Self {
            f,
            conversation: conversation_for_receive,
            receiver,
            appended,
            applications,
            routes,
            delivered,
            faults,
            stop,
            worker: Some(server),
        }
    }

    pub fn prepare(&self, media: &[u8]) -> String {
        self.f.enqueue();
        fs::write(self.f.dir().join("compressed"), media).unwrap();
        assert_eq!(self.f.advance()["stage"], "continue");
        assert_eq!(self.f.advance()["stage"], "continue");
        fs::copy(
            self.f.dir().join("ciphertext.age"),
            self.verification_path(),
        )
        .unwrap();
        fs::read_to_string(self.f.dir().join("job.age")).unwrap()
    }

    fn verification_path(&self) -> std::path::PathBuf {
        self.f.root.join(format!("verification-{}.age", self.f.id))
    }

    pub fn complete_upload(&self) {
        let before = self.routes.lock().unwrap().len();
        assert_eq!(self.f.advance()["stage"], "upload");
        assert_eq!(&self.routes.lock().unwrap()[before..], ["/api/uploadthing"]);
        // Restarting after authorization reconciles before attempting another transfer.
        assert_eq!(self.f.advance()["stage"], "upload");
        assert_eq!(
            self.routes.lock().unwrap().last().unwrap(),
            "/api/trpc/mls.uploadStatus"
        );
        complete_send_upload(self.f.config.clone(), self.f.id.clone(), true).unwrap();
        assert_eq!(self.f.advance()["stage"], "confirm");
        assert!(self.f.dir().join("ciphertext.age").exists());
        self.delivered.store(true, Ordering::SeqCst);
        assert_eq!(self.f.advance()["stage"], "continue");
        assert_eq!(self.f.advance()["stage"], "sent");
        assert!(!self.f.dir().join("ciphertext.age").exists());
        acknowledge_send_job(self.f.config.clone(), self.f.id.clone()).unwrap();
        assert_eq!(list_send_jobs(self.f.config.clone()).unwrap(), "[]");
    }

    pub fn verify_first_at_peer(&self, expected: &[u8]) {
        let appended = self.appended.lock().unwrap();
        assert_eq!(appended.len(), 1);
        let request = &appended[0];
        self.receiver
            .join_group(
                decode_base64(request["commits"][0]["welcome"].as_str().unwrap().into()).unwrap(),
            )
            .unwrap();
        self.receiver
            .process(decode_base64(request["commits"][1]["data"].as_str().unwrap().into()).unwrap())
            .unwrap();
        self.verify_at_peer(request["ciphertext"].as_str().unwrap(), expected);
    }

    pub fn verify_at_peer(&self, ciphertext: &str, expected: &[u8]) {
        let ReceivedMessage::Application { plaintext, .. } = self
            .receiver
            .process(decode_base64(ciphertext.into()).unwrap())
            .unwrap()
        else {
            panic!("expected application descriptor");
        };
        let descriptor: Value = serde_json::from_slice(&plaintext).unwrap();
        assert_eq!(descriptor["messageId"], self.f.id);
        let output = self.f.root.join(format!("received-{}", self.f.id));
        decrypt_attachment_sync(
            self.verification_path().to_string_lossy().into_owned(),
            output.to_string_lossy().into_owned(),
            descriptor["key"].as_str().unwrap().into(),
        )
        .unwrap();
        assert_eq!(fs::read(output).unwrap(), expected);
    }

    pub fn sync(&self) -> String {
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(sync_native_conversation(
                self.f.config.clone(),
                self.conversation.clone(),
            ))
            .unwrap()
    }

    pub fn descriptor(&self) -> Option<String> {
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(read_native_descriptor(
                self.f.config.clone(),
                self.conversation.clone(),
                self.f.id.clone(),
            ))
            .unwrap()
    }

    pub fn next_send(&mut self) -> String {
        self.delivered.store(false, Ordering::SeqCst);
        self.f.id = new_id();
        self.prepare(b"second private media")
    }
}

impl Drop for SendHarness {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            let result = worker.join();
            if !thread::panicking() {
                result.unwrap();
            }
        }
    }
}
