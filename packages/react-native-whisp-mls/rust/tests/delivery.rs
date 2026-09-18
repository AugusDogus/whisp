use whisp_mls::{
    MlsClient, ReceivedMessage, decrypt_attachment, encrypt_attachment, generate_storage_key,
};

#[test]
fn offline_delivery_survives_restart_and_verifies_device_binding() {
    let storage_key = generate_storage_key();
    let receiver = MlsClient::new("receiver-device".into()).unwrap();
    let key_package = receiver.key_package().unwrap();
    let snapshot = receiver.export_state(storage_key.clone()).unwrap();
    drop(receiver);
    let sender = MlsClient::new("sender-device".into()).unwrap();
    let sender_key = sender.signature_key().unwrap();
    let sender_snapshot = sender.export_state(storage_key.clone()).unwrap();
    let sender = MlsClient::restore_state(sender_snapshot, storage_key.clone()).unwrap();
    assert_eq!(sender_key, sender.signature_key().unwrap());
    sender.create_group(b"message:receiver".to_vec()).unwrap();
    let welcome = sender.add_member(key_package).unwrap().welcome;
    let encrypted = sender
        .encrypt(b"private attachment descriptor".to_vec())
        .unwrap();
    drop(sender);
    let receiver = MlsClient::restore_state(snapshot.clone(), storage_key.clone()).unwrap();
    receiver.join_group(welcome).unwrap();
    assert_eq!(receiver.group_id().unwrap(), b"message:receiver");
    assert!(
        receiver
            .members()
            .unwrap()
            .iter()
            .any(|m| m.device_id == "sender-device" && m.signature_key == sender_key)
    );
    assert_eq!(
        receiver.process(encrypted).unwrap(),
        ReceivedMessage::Application {
            sender: "sender-device".into(),
            plaintext: b"private attachment descriptor".to_vec()
        }
    );
    assert!(MlsClient::restore_state(snapshot.clone(), generate_storage_key()).is_err());
    let mut corrupt = snapshot;
    let last = corrupt.len() - 1;
    corrupt[last] ^= 1;
    assert!(MlsClient::restore_state(corrupt, storage_key).is_err());
}

#[tokio::test]
async fn media_roundtrip_rejects_wrong_keys_tampering_and_truncation_without_publishing_plaintext()
{
    let directory = std::env::temp_dir().join(format!("whisp-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&directory).unwrap();
    let path = |name: &str| directory.join(name).to_str().unwrap().to_string();
    let payload: Vec<u8> = (0..200_000).map(|i| (i % 251) as u8).collect();
    std::fs::write(path("input"), &payload).unwrap();
    let key = encrypt_attachment(path("input"), path("encrypted"))
        .await
        .unwrap();
    decrypt_attachment(path("encrypted"), path("opened"), key.clone())
        .await
        .unwrap();
    assert_eq!(std::fs::read(path("opened")).unwrap(), payload);
    assert!(
        decrypt_attachment(path("encrypted"), path("wrong"), generate_storage_key())
            .await
            .is_err()
    );
    assert!(!std::path::Path::new(&path("wrong")).exists());
    let bytes = std::fs::read(path("encrypted")).unwrap();
    for (name, cut) in [("truncated", bytes.len() - 1), ("chunk-boundary", 65536)] {
        std::fs::write(path(name), &bytes[..cut]).unwrap();
        assert!(
            decrypt_attachment(path(name), path("rejected"), key.clone())
                .await
                .is_err()
        );
        assert!(!std::path::Path::new(&path("rejected")).exists());
        assert!(!std::path::Path::new(&path("rejected.partial")).exists());
    }
    let mut corrupt = bytes;
    corrupt[70_000] ^= 1;
    std::fs::write(path("tampered"), corrupt).unwrap();
    assert!(
        decrypt_attachment(path("tampered"), path("rejected"), key)
            .await
            .is_err()
    );
    assert!(!std::path::Path::new(&path("rejected")).exists());
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn persistent_group_restores_ratchets_and_rotates_epochs_across_sends() {
    let key = generate_storage_key();
    let alice = MlsClient::new("alice".into()).unwrap();
    let bob = MlsClient::new("bob".into()).unwrap();
    alice
        .create_group(b"persistent-conversation".to_vec())
        .unwrap();
    bob.join_group(
        alice
            .add_member(bob.key_package().unwrap())
            .unwrap()
            .welcome,
    )
    .unwrap();
    let first = alice.encrypt(b"first whisp".to_vec()).unwrap();
    bob.process(first.clone()).unwrap();
    let alice_state = alice.export_state(key.clone()).unwrap();
    let bob_state = bob.export_state(key.clone()).unwrap();
    drop(alice);
    drop(bob);
    let alice = MlsClient::restore_state(alice_state, key.clone()).unwrap();
    let bob = MlsClient::restore_state(bob_state, key).unwrap();
    assert!(bob.process(first).is_err());
    bob.process(alice.update_keys().unwrap()).unwrap();
    assert_eq!(
        bob.process(alice.encrypt(b"second whisp".to_vec()).unwrap())
            .unwrap(),
        ReceivedMessage::Application {
            sender: "alice".into(),
            plaintext: b"second whisp".to_vec()
        }
    );
    alice.process(bob.update_keys().unwrap()).unwrap();
    assert_eq!(
        alice
            .process(bob.encrypt(b"reply".to_vec()).unwrap())
            .unwrap(),
        ReceivedMessage::Application {
            sender: "bob".into(),
            plaintext: b"reply".to_vec()
        }
    );
    assert_eq!(alice.group_id().unwrap(), bob.group_id().unwrap());
}

#[tokio::test]
async fn real_media_keys_travel_through_a_persistent_group_across_restarts() {
    let directory = std::env::temp_dir().join(format!("whisp-e2e-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&directory).unwrap();
    let path = |name: &str| directory.join(name).to_str().unwrap().to_string();
    let storage = generate_storage_key();
    let alice = MlsClient::new("alice-device".into()).unwrap();
    let bob = MlsClient::new("bob-device".into()).unwrap();
    alice
        .create_group(b"existing-direct-conversation".to_vec())
        .unwrap();
    bob.join_group(
        alice
            .add_member(bob.key_package().unwrap())
            .unwrap()
            .welcome,
    )
    .unwrap();
    let mut sender_state = alice.export_state(storage.clone()).unwrap();
    let mut receiver_state = bob.export_state(storage.clone()).unwrap();
    drop(alice);
    drop(bob);
    for sequence in 0..3 {
        let sender = MlsClient::restore_state(sender_state, storage.clone()).unwrap();
        let receiver = MlsClient::restore_state(receiver_state, storage.clone()).unwrap();
        let content = format!("private media payload {sequence}").repeat(20_000);
        std::fs::write(path("source"), content.as_bytes()).unwrap();
        let encrypted_path = path(&format!("encrypted-{sequence}"));
        let media_key = encrypt_attachment(path("source"), encrypted_path.clone())
            .await
            .unwrap();
        let descriptor =
            serde_json::json!({ "messageId": sequence, "key": media_key, "mimeType": "video/mp4" });
        receiver.process(sender.update_keys().unwrap()).unwrap();
        let wire = sender
            .encrypt(serde_json::to_vec(&descriptor).unwrap())
            .unwrap();
        let ReceivedMessage::Application {
            plaintext,
            sender: authenticated,
        } = receiver.process(wire).unwrap()
        else {
            panic!("Expected application data");
        };
        assert_eq!(authenticated, "alice-device");
        let opened: serde_json::Value = serde_json::from_slice(&plaintext).unwrap();
        decrypt_attachment(
            encrypted_path,
            path(&format!("opened-{sequence}")),
            opened["key"].as_str().unwrap().to_string(),
        )
        .await
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(path(&format!("opened-{sequence}"))).unwrap(),
            content
        );
        assert_eq!(
            receiver.group_id().unwrap(),
            b"existing-direct-conversation"
        );
        sender_state = sender.export_state(storage.clone()).unwrap();
        receiver_state = receiver.export_state(storage.clone()).unwrap();
    }
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn one_membership_commit_adds_multiple_devices_to_the_same_epoch() {
    let alice = MlsClient::new("alice".into()).unwrap();
    let bob = MlsClient::new("bob-phone".into()).unwrap();
    let laptop = MlsClient::new("bob-laptop".into()).unwrap();
    alice.create_group(b"one-conversation".to_vec()).unwrap();
    let invitation = alice
        .add_members(vec![
            bob.key_package().unwrap(),
            laptop.key_package().unwrap(),
        ])
        .unwrap();
    bob.join_group(invitation.welcome.clone()).unwrap();
    laptop.join_group(invitation.welcome).unwrap();
    let ciphertext = alice.encrypt(b"same whisp".to_vec()).unwrap();
    assert_eq!(
        bob.process(ciphertext.clone()).unwrap(),
        laptop.process(ciphertext).unwrap()
    );
    let removal = alice.remove_member("bob-laptop".into()).unwrap();
    bob.process(removal).unwrap();
    let next = alice.encrypt(b"next whisp".to_vec()).unwrap();
    assert!(laptop.process(next.clone()).is_err());
    assert!(bob.process(next).is_ok());
}

#[test]
fn self_conversation_rotates_with_one_device_and_can_add_another_after_restart() {
    let storage = generate_storage_key();
    let phone = MlsClient::new("self-phone".into()).unwrap();
    phone.create_group(b"self-conversation".to_vec()).unwrap();
    phone.update_keys().unwrap();
    phone.encrypt(b"first self whisp".to_vec()).unwrap();
    let snapshot = phone.export_state(storage.clone()).unwrap();
    drop(phone);
    let phone = MlsClient::restore_state(snapshot, storage).unwrap();
    let tablet = MlsClient::new("self-tablet".into()).unwrap();
    tablet
        .join_group(
            phone
                .add_member(tablet.key_package().unwrap())
                .unwrap()
                .welcome,
        )
        .unwrap();
    tablet.process(phone.update_keys().unwrap()).unwrap();
    assert_eq!(
        tablet
            .process(phone.encrypt(b"next self whisp".to_vec()).unwrap())
            .unwrap(),
        ReceivedMessage::Application {
            sender: "self-phone".into(),
            plaintext: b"next self whisp".to_vec(),
        }
    );
}
