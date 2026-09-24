use serde_json::Value;
use std::{fs, sync::atomic::Ordering};
use whisp_mls::*;

#[path = "support/send_fixture.rs"]
mod fixture;
#[path = "support/send_harness.rs"]
mod harness;
use fixture::replace_phase;
use harness::{Capabilities, Recipient, SendHarness};

#[test]
fn native_send_recovers_accepted_append_without_a_second_application() {
    for recipient in [Recipient::Peer, Recipient::SelfOnly] {
        for capabilities in [
            Capabilities::Legacy,
            Capabilities::InlineIdentity,
            Capabilities::AtomicBegin,
        ] {
            let h = SendHarness::new(recipient, capabilities);
            h.faults.lose_append.store(true, Ordering::SeqCst);
            h.prepare(b"private media");
            assert_eq!(h.f.advance()["failure"]["disposition"], "retry");
            assert_eq!(h.f.advance()["stage"], "continue");
            h.complete_upload();
            assert_eq!(h.appended.lock().unwrap().len(), 1);
            if recipient == Recipient::Peer {
                h.verify_first_at_peer(b"private media");
            }
        }
    }
}

#[test]
fn atomic_begin_conflict_retries_before_recovering_a_lost_append_response() {
    for recipient in [Recipient::Peer, Recipient::SelfOnly] {
        let h = SendHarness::new(recipient, Capabilities::AtomicBegin);
        h.faults.conflict.store(true, Ordering::SeqCst);
        h.faults.lose_append.store(true, Ordering::SeqCst);
        h.prepare(b"private media");
        assert_eq!(h.f.advance()["failure"]["disposition"], "retry");
        assert_eq!(h.f.advance()["stage"], "continue");
        assert_eq!(
            &h.routes.lock().unwrap()[..4],
            [
                "/api/trpc/mls.prepare",
                "/api/trpc/mls.beginSend",
                "/api/trpc/mls.sync",
                "/api/trpc/mls.beginSend",
            ]
        );
        h.complete_upload();
        assert_eq!(h.appended.lock().unwrap().len(), 1);
        if recipient == Recipient::Peer {
            h.verify_first_at_peer(b"private media");
        }
    }
}

#[test]
fn native_send_avoids_redundant_requests_but_rechecks_resumed_uploads() {
    for capabilities in [Capabilities::InlineIdentity, Capabilities::AtomicBegin] {
        let h = SendHarness::new(Recipient::SelfOnly, capabilities);
        let checkpoint = h.prepare(b"private media");
        assert_eq!(h.f.advance()["stage"], "continue");
        let expected = match capabilities {
            Capabilities::AtomicBegin => vec![
                "/api/trpc/mls.prepare",
                "/api/trpc/mls.beginSend",
                "/api/trpc/mls.append",
            ],
            _ => vec![
                "/api/trpc/mls.prepare",
                "/api/trpc/mls.sync",
                "/api/trpc/mls.begin",
                "/api/trpc/mls.append",
            ],
        };
        assert_eq!(*h.routes.lock().unwrap(), expected);
        if capabilities == Capabilities::AtomicBegin {
            fs::write(h.f.dir().join("job.age"), checkpoint).unwrap();
            let before = h.routes.lock().unwrap().len();
            assert_eq!(h.f.advance()["stage"], "continue");
            assert_eq!(
                &h.routes.lock().unwrap()[before..],
                ["/api/trpc/mls.prepare", "/api/trpc/mls.beginSend"]
            );
        }
        let state_path =
            h.f.root
                .join("conversations")
                .join(format!("{}.age", h.conversation));
        let before = fs::read(&state_path).unwrap();
        let descriptors: Value = serde_json::from_str(&h.sync()).unwrap();
        assert_eq!(descriptors[&h.f.id]["messageId"], h.f.id);
        assert_eq!(fs::read(&state_path).unwrap(), before);
        let cached: Value = serde_json::from_str(&h.descriptor().unwrap()).unwrap();
        assert_eq!(cached, descriptors[&h.f.id]);
        h.complete_upload();
        assert_eq!(h.sync(), "{}");
        assert!(h.descriptor().is_none());
    }
}

fn established_peer() -> SendHarness {
    let h = SendHarness::new(Recipient::Peer, Capabilities::Applications);
    h.prepare(b"private media");
    assert_eq!(h.f.advance()["stage"], "continue");
    assert_eq!(
        *h.routes.lock().unwrap(),
        [
            "/api/trpc/mls.prepare",
            "/api/trpc/mls.beginSend",
            "/api/trpc/mls.append"
        ]
    );
    h.complete_upload();
    h.verify_first_at_peer(b"private media");
    h
}

#[test]
fn native_second_send_uses_application_capability_without_another_commit() {
    let mut h = established_peer();
    h.next_send();
    let before = h.routes.lock().unwrap().len();
    assert_eq!(h.f.advance()["stage"], "continue");
    assert_eq!(
        &h.routes.lock().unwrap()[before..],
        ["/api/trpc/mls.prepare", "/api/trpc/mls.publishApplication"]
    );
    h.complete_upload();
    assert_eq!(h.appended.lock().unwrap().len(), 1);
    let applications = h.applications.lock().unwrap();
    assert_eq!(applications.len(), 1);
    h.verify_at_peer(
        applications[0]["ciphertext"].as_str().unwrap(),
        b"second private media",
    );
}

#[test]
fn native_send_recovers_application_ack_before_job_checkpoint_without_duplicate_commit() {
    let mut h = established_peer();
    let checkpoint = h.next_send();
    assert_eq!(h.f.advance()["stage"], "continue");
    fs::write(h.f.dir().join("job.age"), checkpoint).unwrap();
    h.faults.cancel_application.store(true, Ordering::SeqCst);
    let before = h.routes.lock().unwrap().len();
    assert_eq!(h.f.advance()["stage"], "continue");
    assert_eq!(
        &h.routes.lock().unwrap()[before..],
        [
            "/api/trpc/mls.prepare",
            "/api/trpc/mls.publishApplication",
            "/api/trpc/mls.beginSend",
        ]
    );
    h.complete_upload();
    assert_eq!(h.appended.lock().unwrap().len(), 1);
    let attempts = h.applications.lock().unwrap();
    assert_eq!(attempts.len(), 2);
    assert_ne!(attempts[0]["ciphertext"], attempts[1]["ciphertext"]);
    h.verify_at_peer(
        attempts[0]["ciphertext"].as_str().unwrap(),
        b"second private media",
    );
}

#[test]
fn foreground_receive_settles_application_after_pending_send_job_expires() {
    let mut h = established_peer();
    h.next_send();
    h.faults.lose_application.store(true, Ordering::SeqCst);
    let before = h.routes.lock().unwrap().len();
    assert_eq!(h.f.advance()["stage"], "paused");
    assert_eq!(
        &h.routes.lock().unwrap()[before..],
        ["/api/trpc/mls.prepare", "/api/trpc/mls.publishApplication"]
    );
    let config: Value = serde_json::from_str(&h.f.config).unwrap();
    let job: Value = serde_json::from_str(
        &open_local(
            decode_base64(fs::read_to_string(h.f.dir().join("job.age")).unwrap()).unwrap(),
            config["storageKey"].as_str().unwrap().into(),
        )
        .unwrap(),
    )
    .unwrap();
    replace_phase(&h.f, job["phase"].clone(), 0);
    assert_eq!(h.f.advance()["stage"], "failed");
    assert!(!h.f.dir().join("ciphertext.age").exists());
    acknowledge_send_job(h.f.config.clone(), h.f.id.clone()).unwrap();
    assert!(!h.f.dir().exists());
    let before = h.routes.lock().unwrap().len();
    h.sync();
    assert_eq!(
        &h.routes.lock().unwrap()[before..],
        [
            "/api/trpc/mls.publishApplication",
            "/api/trpc/mls.sync",
            "/api/trpc/mls.retainedMessages",
        ]
    );
    let attempts = h.applications.lock().unwrap();
    assert_eq!(attempts.len(), 2);
    assert_eq!(attempts[0], attempts[1]);
    assert_eq!(h.appended.lock().unwrap().len(), 1);
    h.verify_at_peer(
        attempts[0]["ciphertext"].as_str().unwrap(),
        b"second private media",
    );
}
