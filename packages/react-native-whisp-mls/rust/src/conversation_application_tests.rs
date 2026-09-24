use super::*;
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    thread,
    time::{Duration, Instant},
};

struct Fixture {
    config: SendConfig,
    id: String,
    state: State,
    peer: MlsClient,
}

impl Fixture {
    fn new(listener: &TcpListener) -> Self {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(root.join("conversations")).unwrap();
        let config = SendConfig {
            root: root.to_string_lossy().into_owned(),
            user_id: "alice".into(),
            device_id: uuid::Uuid::new_v4().to_string(),
            storage_key: crate::generate_storage_key(),
            cookie: "session=test".into(),
            base_url: format!("http://{}", listener.local_addr().unwrap()),
            uploadthing_version: String::new(),
            allow_insecure_http: true,
        };
        let id = uuid::Uuid::new_v4().to_string();
        let sender = MlsClient::new(config.device_id.clone()).unwrap();
        let peer = MlsClient::new(uuid::Uuid::new_v4().to_string()).unwrap();
        sender.create_group(id.as_bytes().to_vec()).unwrap();
        peer.join_group(
            sender
                .add_member(peer.key_package().unwrap())
                .unwrap()
                .welcome,
        )
        .unwrap();
        let members = sender
            .members()
            .unwrap()
            .into_iter()
            .map(|member| Member {
                user_id: if member.device_id == config.device_id {
                    "alice"
                } else {
                    "bob"
                }
                .into(),
                device_id: member.device_id,
                signature_key: encode_base64(member.signature_key),
            })
            .collect();
        let state = State {
            snapshot: encode_base64(sender.export_state(config.storage_key.clone()).unwrap()),
            cursor: 2,
            members,
            descriptors: BTreeMap::new(),
            welcome_key_package_id: None,
            last_key_update: Some(application::now().unwrap()),
            sent_since_key_update: 0,
            outgoing: BTreeMap::new(),
        };
        save(
            &config,
            &id,
            &Record {
                current: Some(state.clone()),
                pending: None,
            },
        )
        .unwrap();
        Self {
            config,
            id,
            state,
            peer,
        }
    }

    fn descriptor(&self, sender: &str) -> Descriptor {
        Descriptor {
            version: 1,
            message_id: uuid::Uuid::new_v4().to_string(),
            sender_id: sender.into(),
            group_id: None,
            key: crate::generate_storage_key(),
            mime_type: "image/jpeg".into(),
            thumbhash: None,
        }
    }

    fn record(&self) -> Record {
        load(&self.config, &self.id).unwrap().unwrap()
    }

    fn decrypt_at_peer(&self, input: &Value, descriptor: &Descriptor) {
        let bytes = decode_base64(input["ciphertext"].as_str().unwrap().into()).unwrap();
        let ReceivedMessage::Application { sender, plaintext } = self.peer.process(bytes).unwrap()
        else {
            panic!("Expected application message");
        };
        assert_eq!(sender, self.config.device_id);
        assert_eq!(
            serde_json::from_slice::<Value>(&plaintext).unwrap(),
            serde_json::to_value(descriptor).unwrap()
        );
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.config.root).unwrap();
    }
}

// A real local HTTP boundary exercises durable replay without mocking OpenMLS.
// None simulates an accepted request whose response never reaches the sender.
fn serve(
    listener: TcpListener,
    routes: Vec<&'static str>,
    mut response: impl FnMut(usize, &Value) -> Option<Value> + Send + 'static,
) -> thread::JoinHandle<Vec<Value>> {
    thread::spawn(move || {
        listener.set_nonblocking(true).unwrap();
        let mut requests = Vec::new();
        for (index, route) in routes.into_iter().enumerate() {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut socket = loop {
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        thread::sleep(Duration::from_millis(2))
                    }
                    Err(error) => panic!("Expected {route} request: {error}"),
                }
            };
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let mut request_line = line.split_whitespace();
            let method = request_line.next().unwrap().to_owned();
            let target = request_line.next().unwrap().to_owned();
            let url = reqwest::Url::parse(&format!("http://localhost{target}")).unwrap();
            assert_eq!(url.path(), format!("/api/trpc/mls.{route}"));
            assert_eq!(method, if route == "sync" { "GET" } else { "POST" });
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
            let input: Value = if method == "GET" {
                serde_json::from_str(&url.query_pairs().find(|(key, _)| key == "input").unwrap().1)
                    .unwrap()
            } else {
                let mut bytes = vec![0; length];
                reader.read_exact(&mut bytes).unwrap();
                serde_json::from_slice(&bytes).unwrap()
            };
            if let Some(result) = response(index, &input["json"]) {
                let body = json!({"result":{"data":{"json":result}}}).to_string();
                write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            }
            requests.push(input["json"].clone());
        }
        requests
    })
}

fn accepted(input: &Value, revision: u64) -> Value {
    json!({"kind":"published", "revision":revision, "epoch":input["epoch"], "retainedMessageIds":[input["draftId"]]})
}

#[test]
fn application_lost_response_replays_exact_durable_ciphertext_without_reencrypting() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let fixture = Fixture::new(&listener);
    let descriptor = fixture.descriptor("alice");
    let server = serve(listener, vec!["publishApplication"; 2], |index, input| {
        (index == 1).then(|| accepted(input, 3))
    });
    let api = Api::new(&fixture.config).unwrap();
    assert!(matches!(
        send(&api, &fixture.id, &descriptor, true, true),
        Err(MlsError::Transport)
    ));
    let staged = fixture.record();
    assert!(matches!(staged.pending, Some(Pending::Application { .. })));
    let advanced = staged.current.unwrap();
    assert_eq!(advanced.sent_since_key_update, 1);
    assert_ne!(advanced.snapshot, fixture.state.snapshot);
    send(&api, &fixture.id, &descriptor, true, true).unwrap();
    let completed = fixture.record();
    assert!(completed.pending.is_none());
    let state = completed.current.unwrap();
    assert_eq!(state.snapshot, advanced.snapshot);
    assert_eq!(state.sent_since_key_update, 1);
    assert_eq!(state.cursor, 3);
    let requests = server.join().unwrap();
    assert_eq!(requests[0], requests[1]);
    fixture.decrypt_at_peer(&requests[1], &descriptor);
}

#[test]
fn cancelled_application_keeps_consumed_generation_for_the_next_message() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let fixture = Fixture::new(&listener);
    let first = fixture.descriptor("alice");
    let second = fixture.descriptor("alice");
    let (advanced, _) =
        application::stage(&fixture.config, &fixture.id, &fixture.state, &first).unwrap();
    let server = serve(listener, vec!["publishApplication"; 2], |index, input| {
        Some(if index == 0 {
            json!({"kind":"cancelled"})
        } else {
            accepted(input, 3)
        })
    });
    let api = Api::new(&fixture.config).unwrap();
    let (current, outcome) = recover(&api, &fixture.id).unwrap();
    assert!(matches!(outcome, Some(application::Outcome::Cancelled)));
    let current = current.unwrap();
    assert_eq!(current.snapshot, advanced.snapshot);
    assert_eq!(current.sent_since_key_update, 1);
    assert_eq!(current.cursor, fixture.state.cursor);
    assert!(fixture.record().pending.is_none());
    send(&api, &fixture.id, &second, true, true).unwrap();
    let requests = server.join().unwrap();
    fixture.decrypt_at_peer(&requests[0], &first);
    fixture.decrypt_at_peer(&requests[1], &second);
    assert_eq!(fixture.record().current.unwrap().sent_since_key_update, 2);
}

#[test]
fn warm_sequential_applications_publish_without_begin_or_commit_and_keep_epoch() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let fixture = Fixture::new(&listener);
    let descriptors: Vec<_> = (0..3).map(|_| fixture.descriptor("alice")).collect();
    let epoch = fixture.peer.epoch().unwrap();
    let server = serve(listener, vec!["publishApplication"; 3], |index, input| {
        Some(accepted(input, index as u64 + 3))
    });
    let api = Api::new(&fixture.config).unwrap();
    for descriptor in &descriptors {
        send(&api, &fixture.id, descriptor, true, true).unwrap();
    }
    for (request, descriptor) in server.join().unwrap().iter().zip(&descriptors) {
        assert_eq!(request["epoch"], epoch);
        fixture.decrypt_at_peer(request, descriptor);
    }
    let state = fixture.record().current.unwrap();
    assert_eq!(state.cursor, 5);
    assert_eq!(state.sent_since_key_update, 3);
    assert_eq!(
        restore(&fixture.config, &state.snapshot)
            .unwrap()
            .epoch()
            .unwrap(),
        epoch
    );
}

#[test]
fn application_ack_gap_preserves_cursor_until_peer_and_exact_own_echo_are_verified() {
    for tampered in [
        None,
        Some("data"),
        Some("senderId"),
        Some("messageId"),
        Some("groupId"),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let fixture = Fixture::new(&listener);
        let own = fixture.descriptor("alice");
        let peer = fixture.descriptor("bob");
        let peer_ciphertext = encode_base64(
            fixture
                .peer
                .encrypt(serde_json::to_vec(&peer).unwrap())
                .unwrap(),
        );
        let sender_device_id = fixture.config.device_id.clone();
        let peer_device_id = fixture
            .state
            .members
            .iter()
            .find(|member| member.user_id == "bob")
            .unwrap()
            .device_id
            .clone();
        let peer_id = peer.message_id.clone();
        let own_id = own.message_id.clone();
        let mut published = Value::Null;
        let server = serve(
            listener,
            vec!["publishApplication", "sync"],
            move |index, input| {
                if index == 0 {
                    published = input.clone();
                    return Some(accepted(input, 4));
                }
                assert_eq!(input["after"], 2);
                let mut own_event = json!({"kind":"application","data":published["ciphertext"],"senderDeviceId":sender_device_id,"senderId":"alice","messageId":own_id,"groupId":null});
                if let Some(field) = tampered {
                    own_event[field] = json!("tampered");
                }
                Some(
                    json!({"conversation":{"revision":4},"welcome":null,"retainedMessageIds":[peer_id,own_id],"events":[
                        {"sequence":3,"entry":{"kind":"application","data":peer_ciphertext,"senderDeviceId":peer_device_id,"senderId":"bob","messageId":peer_id,"groupId":null}},
                        {"sequence":4,"entry":own_event}
                    ]}),
                )
            },
        );
        let api = Api::new(&fixture.config).unwrap();
        send(&api, &fixture.id, &own, true, true).unwrap();
        let before_sync = fixture.record().current.unwrap();
        assert_eq!(before_sync.cursor, 2);
        assert_eq!(before_sync.outgoing.len(), 1);
        assert!(before_sync.outgoing.contains_key(&4));
        let result = sync(&api, &fixture.id, None);
        if tampered.is_some() {
            assert!(result.is_err());
            let unchanged = fixture.record().current.unwrap();
            assert_eq!(unchanged.snapshot, before_sync.snapshot);
            assert_eq!(unchanged.cursor, 2);
            assert_eq!(unchanged.outgoing.len(), 1);
        } else {
            let state = result.unwrap().0.unwrap();
            assert_eq!(state.cursor, 4);
            assert!(state.outgoing.is_empty());
            assert!(state.descriptors.contains_key(&peer.message_id));
        }
        server.join().unwrap();
    }
}

#[test]
fn application_refresh_policy_rejects_legacy_expired_exhausted_and_future_states() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let fixture = Fixture::new(&listener);
    let mut state = fixture.state.clone();
    assert!(application::can_send(&state).unwrap());
    state.sent_since_key_update = 99;
    assert!(application::can_send(&state).unwrap());
    let descriptor = fixture.descriptor("alice");
    let (advanced, _) =
        application::stage(&fixture.config, &fixture.id, &state, &descriptor).unwrap();
    // An attempt consumes a generation before any server outcome, even cancellation.
    assert_eq!(advanced.sent_since_key_update, 100);
    assert!(!application::can_send(&advanced).unwrap());
    state.sent_since_key_update = 0;
    let now = application::now().unwrap();
    state.last_key_update = Some(now - 24 * 60 * 60);
    assert!(!application::can_send(&state).unwrap());
    state.last_key_update = Some(now + 60);
    assert!(!application::can_send(&state).unwrap());

    let mut old_state = serde_json::to_value(&fixture.state).unwrap();
    let fields = old_state.as_object_mut().unwrap();
    fields.remove("lastKeyUpdate");
    fields.remove("sentSinceKeyUpdate");
    fields.remove("outgoing");
    let legacy: State = serde_json::from_value(old_state.clone()).unwrap();
    assert!(!application::can_send(&legacy).unwrap());
    assert!(legacy.outgoing.is_empty());
    let record: Record = serde_json::from_value(json!({
        "current":old_state,
        "pending":{"operationId":uuid::Uuid::new_v4().to_string(),"next":old_state}
    }))
    .unwrap();
    assert!(matches!(record.pending, Some(Pending::Commit { .. })));
}

#[test]
fn invalid_applications_do_not_block_later_messages_or_consume_their_keys() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let fixture = Fixture::new(&listener);
    let descriptor = fixture.descriptor("bob");
    let peer_id = fixture
        .state
        .members
        .iter()
        .find(|m| m.user_id == "bob")
        .unwrap()
        .device_id
        .clone();
    let valid = fixture
        .peer
        .encrypt(serde_json::to_vec(&descriptor).unwrap())
        .unwrap();
    let mut tampered = valid.clone();
    *tampered.last_mut().unwrap() ^= 1;
    // A commit mislabeled by the delivery service must not advance the group.
    let commit = fixture.peer.update_keys().unwrap();
    let message_id = descriptor.message_id.clone();
    let server = serve(
        listener,
        vec!["sync", "sync", "sync"],
        move |index, input| {
            let entry = |data: String| {
                json!({"kind":"application", "data":data,
            "senderDeviceId":peer_id,"senderId":"bob","messageId":message_id,"groupId":null})
            };
            match index {
                0 => {
                    assert_eq!(input["after"], 2);
                    Some(json!({"conversation":{"revision":6},"welcome":null,
                    "retainedMessageIds":[message_id],"events":[
                        {"sequence":3,"entry":entry("not base64".into())},
                        {"sequence":4,"entry":entry("AAAA".into())},
                        {"sequence":5,"entry":entry(encode_base64(tampered.clone()))},
                        {"sequence":6,"entry":entry(encode_base64(commit.clone()))}
                    ]}))
                }
                1 => {
                    assert_eq!(input["after"], 6);
                    Some(json!({"conversation":{"revision":7},"welcome":null,
                    "retainedMessageIds":[message_id],"events":[
                        {"sequence":7,"entry":entry(encode_base64(valid.clone()))}
                    ]}))
                }
                _ => {
                    assert_eq!(input["after"], 7);
                    Some(json!({"conversation":{"revision":7},"welcome":null,
                    "retainedMessageIds":[message_id],"events":[]}))
                }
            }
        },
    );
    let api = Api::new(&fixture.config).unwrap();
    let skipped = sync(&api, &fixture.id, None).unwrap().0.unwrap();
    assert_eq!(skipped.cursor, 6);
    assert!(skipped.descriptors.is_empty());
    assert_eq!(fixture.record().current.unwrap().cursor, 6);
    let received = sync(&api, &fixture.id, None).unwrap().0.unwrap();
    assert_eq!(received.cursor, 7);
    assert_eq!(
        received.descriptors[&descriptor.message_id].key,
        descriptor.key
    );
    // A restarted receive reads the same durable descriptor without replay.
    let restored = sync(&api, &fixture.id, None).unwrap().0.unwrap();
    assert!(restored.descriptors.contains_key(&descriptor.message_id));
    server.join().unwrap();
}

#[test]
fn rejected_sender_binding_preserves_application_for_the_authenticated_sender() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let fixture = Fixture::new(&listener);
    let receiver = restore(&fixture.config, &fixture.state.snapshot).unwrap();
    let peer_id = fixture
        .state
        .members
        .iter()
        .find(|m| m.user_id == "bob")
        .unwrap()
        .device_id
        .clone();
    let bytes = fixture.peer.encrypt(b"descriptor".to_vec()).unwrap();
    assert_eq!(
        receiver
            .process_application(bytes.clone(), "wrong-device")
            .unwrap(),
        None
    );
    assert_eq!(
        receiver
            .process_application(bytes.clone(), &peer_id)
            .unwrap(),
        Some(b"descriptor".to_vec())
    );
    assert_eq!(receiver.process_application(bytes, &peer_id).unwrap(), None);
}
