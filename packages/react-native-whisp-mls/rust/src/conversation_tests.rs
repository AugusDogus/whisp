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

    record.pending = Some(Pending {
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
