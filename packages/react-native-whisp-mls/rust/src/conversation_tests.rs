use super::*;

#[test]
fn descriptor_cache_requires_authenticated_settled_device_state() {
    let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(root.join("conversations")).unwrap();
    let mut config = SendConfig {
        root: root.to_string_lossy().into_owned(),
        user_id: "alice".into(),
        device_id: uuid::Uuid::new_v4().to_string(),
        storage_key: crate::generate_storage_key(),
        cookie: "session=test".into(),
        base_url: "https://unused.invalid".into(),
        uploadthing_version: String::new(),
        allow_insecure_http: false,
    };
    let conversation = uuid::Uuid::new_v4().to_string();
    let message = uuid::Uuid::new_v4().to_string();
    let descriptor = Descriptor {
        version: 1,
        message_id: message.clone(),
        sender_id: "bob".into(),
        group_id: None,
        key: crate::generate_storage_key(),
        mime_type: "image/jpeg".into(),
        thumbhash: None,
    };
    let state = State {
        // Cached reads need no MLS ratchet restoration. Only the outer
        // authenticated record's previously verified descriptor is read.
        snapshot: String::new(),
        cursor: 2,
        members: vec![Member {
            device_id: config.device_id.clone(),
            user_id: config.user_id.clone(),
            signature_key: "pinned-key".into(),
        }],
        descriptors: BTreeMap::from([(message.clone(), descriptor)]),
        welcome_key_package_id: None,
        last_key_update: None,
        sent_since_key_update: 0,
        outgoing: BTreeMap::new(),
    };
    assert!(
        cached_descriptor(&config, &conversation, &message)
            .unwrap()
            .is_none()
    );
    let mut record = Record {
        current: Some(state.clone()),
        pending: None,
    };
    save(&config, &conversation, &record).unwrap();
    assert!(
        cached_descriptor(&config, &conversation, &message)
            .unwrap()
            .is_some()
    );
    assert!(
        cached_descriptor(&config, &conversation, &uuid::Uuid::new_v4().to_string())
            .unwrap()
            .is_none()
    );

    record.pending = Some(Pending::Commit {
        operation_id: uuid::Uuid::new_v4().to_string(),
        next: state.clone(),
    });
    save(&config, &conversation, &record).unwrap();
    assert!(
        cached_descriptor(&config, &conversation, &message)
            .unwrap()
            .is_none()
    );
    record.pending = None;
    let mut retiring = state.clone();
    retiring.welcome_key_package_id = Some(uuid::Uuid::new_v4().to_string());
    record.current = Some(retiring);
    save(&config, &conversation, &record).unwrap();
    assert!(
        cached_descriptor(&config, &conversation, &message)
            .unwrap()
            .is_none()
    );

    record.current = Some(state);
    save(&config, &conversation, &record).unwrap();
    config.user_id = "another-account".into();
    assert!(cached_descriptor(&config, &conversation, &message).is_err());
    config.user_id = "alice".into();
    config.device_id = uuid::Uuid::new_v4().to_string();
    assert!(cached_descriptor(&config, &conversation, &message).is_err());
    config.storage_key = crate::generate_storage_key();
    assert!(cached_descriptor(&config, &conversation, &message).is_err());
    fs::write(path(&config, &conversation).unwrap(), "corrupted").unwrap();
    assert!(cached_descriptor(&config, &conversation, &message).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn warm_send_uses_atomic_begin_and_prunes_retired_descriptors() {
    use std::{
        io::{BufRead, BufReader, Read, Write},
        net::TcpListener,
        thread,
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
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
    let client = MlsClient::new(config.device_id.clone()).unwrap();
    client.create_group(id.as_bytes().to_vec()).unwrap();
    let member = Member {
        device_id: config.device_id.clone(),
        user_id: config.user_id.clone(),
        signature_key: encode_base64(client.signature_key().unwrap()),
    };
    let descriptor = Descriptor {
        version: 1,
        message_id: uuid::Uuid::new_v4().to_string(),
        sender_id: "alice".into(),
        group_id: None,
        key: crate::generate_storage_key(),
        mime_type: "image/jpeg".into(),
        thumbhash: None,
    };
    let retired = Descriptor {
        message_id: uuid::Uuid::new_v4().to_string(),
        ..descriptor.clone()
    };
    save(
        &config,
        &id,
        &Record {
            current: Some(State {
                snapshot: encode_base64(client.export_state(config.storage_key.clone()).unwrap()),
                cursor: 2,
                members: vec![member.clone()],
                descriptors: BTreeMap::from([(retired.message_id.clone(), retired)]),
                welcome_key_package_id: None,
                last_key_update: None,
                sent_since_key_update: 0,
                outgoing: BTreeMap::new(),
            }),
            pending: None,
        },
    )
    .unwrap();
    let expected_draft = descriptor.message_id.clone();
    let server = thread::spawn(move || {
        for expected in ["beginSend", "append", "published"] {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let route = if expected == "published" {
                "beginSend"
            } else {
                expected
            };
            assert!(line.starts_with(&format!("POST /api/trpc/mls.{route} ")));
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
            let mut bytes = vec![0; length];
            reader.read_exact(&mut bytes).unwrap();
            let input: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(input["json"]["draftId"], expected_draft);
            let result = if expected == "beginSend" {
                assert_eq!(input["json"]["revision"], 2);
                json!({"kind":"operation", "operation": {"operationId":uuid::Uuid::new_v4().to_string(),
                    "members":[member], "packages":[]}, "retainedMessageIds":[]})
            } else if expected == "append" {
                json!({"revision":4})
            } else {
                assert_eq!(input["json"]["revision"], 4);
                json!({"kind":"published", "retainedMessageIds":[]})
            };
            let body = json!({"result":{"data":{"json":result}}}).to_string();
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        }
    });
    send(&Api::new(&config).unwrap(), &id, &descriptor, true, false).unwrap();
    let record = load(&config, &id).unwrap().unwrap();
    assert!(record.pending.is_none());
    let state = record.current.unwrap();
    assert_eq!(state.cursor, 4);
    assert_eq!(state.descriptors.len(), 1);
    assert!(state.descriptors.contains_key(&descriptor.message_id));
    // A different device viewed the whisp while the job was paused. A receipt
    // retry must retire the local key even though no new append is needed.
    send(&Api::new(&config).unwrap(), &id, &descriptor, true, false).unwrap();
    server.join().unwrap();
    assert!(
        load(&config, &id)
            .unwrap()
            .unwrap()
            .current
            .unwrap()
            .descriptors
            .is_empty()
    );
    fs::remove_dir_all(root).unwrap();
}
