use openmls::prelude::MlsMessageIn;
use tls_codec::Deserialize;
use whisp_mls::{MlsClient, MlsError, ReceivedMessage, generate_storage_key};

fn pair() -> Result<(MlsClient, MlsClient), MlsError> {
    let alice = MlsClient::new("alice-device".into())?;
    let bob = MlsClient::new("bob-device".into())?;
    alice.create_group(b"persistent-conversation".to_vec())?;
    bob.join_group(alice.add_member(bob.key_package()?)?.welcome)?;
    Ok((alice, bob))
}

fn epoch(ciphertext: &[u8]) -> u64 {
    MlsMessageIn::tls_deserialize_exact(ciphertext)
        .unwrap()
        .try_into_protocol_message()
        .unwrap()
        .epoch()
        .as_u64()
}

fn receive(receiver: &MlsClient, ciphertext: Vec<u8>, sender: &str, plaintext: &[u8]) {
    assert_eq!(
        receiver.process(ciphertext).unwrap(),
        ReceivedMessage::Application {
            sender: sender.into(),
            plaintext: plaintext.into(),
        }
    );
}

#[test]
fn applications_advance_sender_ratchet_without_per_message_commits() -> Result<(), MlsError> {
    let (alice, bob) = pair()?;
    let first = alice.encrypt(b"first".to_vec())?;
    let initial_epoch = epoch(&first);
    receive(&bob, first, "alice-device", b"first");
    for index in 0..128 {
        let plaintext = format!("photo descriptor {index}");
        let ciphertext = alice.encrypt(plaintext.as_bytes().to_vec())?;
        assert_eq!(epoch(&ciphertext), initial_epoch);
        receive(&bob, ciphertext, "alice-device", plaintext.as_bytes());
    }
    assert_eq!(
        bob.process(alice.update_keys()?)?,
        ReceivedMessage::GroupUpdated {
            epoch: initial_epoch + 1,
        }
    );
    let refreshed = alice.encrypt(b"after periodic refresh".to_vec())?;
    assert_eq!(epoch(&refreshed), initial_epoch + 1);
    receive(&bob, refreshed, "alice-device", b"after periodic refresh");
    Ok(())
}

#[test]
fn post_encryption_snapshot_preserves_unsent_generation_across_restart() -> Result<(), MlsError> {
    let (alice, bob) = pair()?;
    // The send journal retains these exact bytes alongside the post-encryption
    // snapshot before attempting publication. A crash must not rewind it.
    let pending = alice.encrypt(b"durably staged descriptor".to_vec())?;
    let key = generate_storage_key();
    let snapshot = alice.export_state(key.clone())?;
    drop(alice);
    let alice = MlsClient::restore_state(snapshot, key.clone())?;
    let next = alice.encrypt(b"next descriptor".to_vec())?;
    assert_eq!(epoch(&pending), epoch(&next));
    receive(
        &bob,
        pending.clone(),
        "alice-device",
        b"durably staged descriptor",
    );
    receive(&bob, next, "alice-device", b"next descriptor");
    let bob_snapshot = bob.export_state(key.clone())?;
    drop(bob);
    let bob = MlsClient::restore_state(bob_snapshot, key)?;
    assert!(bob.process(pending).is_err());
    receive(
        &bob,
        alice.encrypt(b"after receiver restart".to_vec())?,
        "alice-device",
        b"after receiver restart",
    );
    Ok(())
}

#[test]
fn opposite_senders_encrypt_concurrently_in_the_same_epoch() -> Result<(), MlsError> {
    let (alice, bob) = pair()?;
    let from_alice = alice.encrypt(b"Alice sends before receiving".to_vec())?;
    let from_bob = bob.encrypt(b"Bob sends before receiving".to_vec())?;
    let initial_epoch = epoch(&from_alice);
    assert_eq!(epoch(&from_bob), initial_epoch);
    receive(
        &alice,
        from_bob,
        "bob-device",
        b"Bob sends before receiving",
    );
    receive(
        &bob,
        from_alice,
        "alice-device",
        b"Alice sends before receiving",
    );

    let key = generate_storage_key();
    let alice = MlsClient::restore_state(alice.export_state(key.clone())?, key.clone())?;
    let bob = MlsClient::restore_state(bob.export_state(key.clone())?, key)?;
    let from_alice = alice.encrypt(b"Alice after restart".to_vec())?;
    let from_bob = bob.encrypt(b"Bob after restart".to_vec())?;
    assert_eq!(epoch(&from_alice), initial_epoch);
    assert_eq!(epoch(&from_bob), initial_epoch);
    receive(&alice, from_bob, "bob-device", b"Bob after restart");
    receive(&bob, from_alice, "alice-device", b"Alice after restart");
    Ok(())
}

#[test]
fn cancelled_old_epoch_message_is_reencrypted_only_after_processing_update() -> Result<(), MlsError>
{
    let (alice, bob) = pair()?;
    let plaintext = b"descriptor awaiting acceptance";
    let cancelled = alice.encrypt(plaintext.to_vec())?;
    let old_epoch = epoch(&cancelled);
    let key = generate_storage_key();
    let advanced = alice.export_state(key.clone())?;
    drop(alice);
    let alice = MlsClient::restore_state(advanced, key)?;

    // A competing commit invalidates publication in the old epoch. Preserve
    // the consumed ratchet, process that commit, then encrypt in the new epoch.
    let commit = bob.update_keys()?;
    assert_eq!(
        alice.process(commit)?,
        ReceivedMessage::GroupUpdated {
            epoch: old_epoch + 1
        }
    );
    let replacement = alice.encrypt(plaintext.to_vec())?;
    assert_eq!(epoch(&replacement), old_epoch + 1);
    assert_ne!(cancelled, replacement);
    assert!(bob.process(cancelled).is_err());
    receive(&bob, replacement, "alice-device", plaintext);
    Ok(())
}
