use whisp_mls::{MlsClient, MlsError, ReceivedMessage};

#[test]
fn independent_clients_exchange_authenticated_ciphertext() -> Result<(), MlsError> {
    let alice = MlsClient::new("alice-device".into())?;
    let bob = MlsClient::new("bob-device".into())?;
    alice.create_group(b"conversation".to_vec())?;
    let invitation = alice.add_member(bob.key_package()?)?;
    bob.join_group(invitation.welcome)?;

    let plaintext = b"an encrypted whisp".to_vec();
    let ciphertext = alice.encrypt(plaintext.clone())?;
    assert!(!ciphertext.windows(plaintext.len()).any(|w| w == plaintext));
    assert_eq!(
        bob.process(ciphertext)?,
        ReceivedMessage::Application {
            sender: "alice-device".into(),
            plaintext,
        }
    );
    assert_eq!(
        alice.process(bob.encrypt(b"reply".to_vec())?)?,
        ReceivedMessage::Application {
            sender: "bob-device".into(),
            plaintext: b"reply".to_vec(),
        }
    );
    Ok(())
}

fn pair() -> Result<(MlsClient, MlsClient), MlsError> {
    let alice = MlsClient::new("alice".into())?;
    let bob = MlsClient::new("bob".into())?;
    alice.create_group(b"conversation".to_vec())?;
    bob.join_group(alice.add_member(bob.key_package()?)?.welcome)?;
    Ok((alice, bob))
}

#[test]
fn removed_member_cannot_read_future_messages_even_without_removal_commit() -> Result<(), MlsError>
{
    let (alice, bob) = pair()?;
    let charlie = MlsClient::new("charlie".into())?;
    let invitation = alice.add_member(charlie.key_package()?)?;
    assert!(matches!(
        bob.process(invitation.commit)?,
        ReceivedMessage::GroupUpdated { .. }
    ));
    charlie.join_group(invitation.welcome)?;

    let before = alice.encrypt(b"before removal".to_vec())?;
    assert!(matches!(
        charlie.process(before.clone())?,
        ReceivedMessage::Application { .. }
    ));
    bob.process(before)?;

    let removal = alice.remove_member("charlie".into())?;
    bob.process(removal.clone())?;
    let after = alice.encrypt(b"after removal".to_vec())?;
    assert!(charlie.process(after.clone()).is_err());
    assert!(matches!(
        bob.process(after.clone())?,
        ReceivedMessage::Application { .. }
    ));
    assert_eq!(charlie.process(removal)?, ReceivedMessage::Removed);
    assert!(charlie.process(after).is_err());
    assert!(charlie.encrypt(b"no longer a member".to_vec()).is_err());
    Ok(())
}

#[test]
fn rejects_replayed_messages() -> Result<(), MlsError> {
    let (alice, bob) = pair()?;
    let ciphertext = alice.encrypt(b"once".to_vec())?;
    bob.process(ciphertext.clone())?;
    assert!(bob.process(ciphertext).is_err());
    assert!(matches!(
        bob.process(alice.encrypt(b"next".to_vec())?)?,
        ReceivedMessage::Application { .. }
    ));
    Ok(())
}

#[test]
fn rejects_tampering_and_messages_from_another_group() -> Result<(), MlsError> {
    let (alice, bob) = pair()?;
    let (other_alice, other_bob) = pair()?;
    let ciphertext = alice.encrypt(b"authentic".to_vec())?;
    let mut tampered = ciphertext.clone();
    if let Some(byte) = tampered.last_mut() {
        *byte ^= 1;
    }
    assert!(bob.process(tampered).is_err());
    assert!(other_bob.process(ciphertext).is_err());
    // A rejected message must not prevent later valid traffic.
    assert!(matches!(
        bob.process(alice.encrypt(b"later".to_vec())?)?,
        ReceivedMessage::Application { .. }
    ));
    assert!(matches!(
        other_bob.process(other_alice.encrypt(b"unrelated".to_vec())?)?,
        ReceivedMessage::Application { .. }
    ));
    Ok(())
}

#[test]
fn validates_wire_format_and_state_boundaries() -> Result<(), MlsError> {
    assert!(MlsClient::new(" ".into()).is_err());
    let (alice, bob) = pair()?;
    assert!(matches!(
        bob.create_group(b"replacement".to_vec()),
        Err(MlsError::AlreadyJoined)
    ));
    assert!(matches!(
        alice.remove_member("missing".into()),
        Err(MlsError::MemberNotFound)
    ));
    assert!(alice.encrypt(vec![0; 64 * 1024 + 1]).is_err());
    assert!(bob.process(vec![0; 1024 * 1024 + 1]).is_err());
    assert!(bob.process(vec![0, 1, 2]).is_err());
    assert!(bob.process(alice.key_package()?).is_err());
    let mut trailing = alice.encrypt(b"no trailing data".to_vec())?;
    trailing.push(0);
    assert!(bob.process(trailing).is_err());
    let outsider = MlsClient::new("outsider".into())?;
    assert!(matches!(
        outsider.encrypt(vec![1]),
        Err(MlsError::NotJoined)
    ));
    Ok(())
}

#[test]
fn welcome_is_bound_to_the_invited_device() -> Result<(), MlsError> {
    let alice = MlsClient::new("alice".into())?;
    let bob = MlsClient::new("bob".into())?;
    // Even a different key with the same claimed name cannot decrypt Bob's Welcome.
    let impostor = MlsClient::new("bob".into())?;
    alice.create_group(b"conversation".to_vec())?;
    let welcome = alice.add_member(bob.key_package()?)?.welcome;
    assert!(impostor.join_group(welcome.clone()).is_err());
    bob.join_group(welcome)?;
    assert!(matches!(
        bob.process(alice.encrypt(b"private".to_vec())?)?,
        ReceivedMessage::Application { .. }
    ));
    Ok(())
}
