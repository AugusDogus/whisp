# Native MLS for Whisp

OpenMLS 0.9.0 implements RFC 9420 using the RustCrypto provider and mandatory
suite `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`. UniFFI generates the
React Native JSI/TurboModule bridge. This package is connected to the actual
Expo upload and viewer paths.

## Conversation lifecycle

Each direct account pair has a persistent MLS group containing both accounts'
registered devices. Each Whisp group has one persistent MLS group containing
its members' registered devices. Sending to several friends encrypts the media
once and sends its secret descriptor through each existing direct conversation.
Other direct recipients are not exposed through a shared MLS roster.

Before sending, the client catches up with the ordered conversation log,
removes departed/revoked devices, adds new devices using reserved one-time
KeyPackages and Welcomes, and commits a fresh self-update. It then encrypts
an application message containing the media key, type, optional thumbhash, sender,
message ID, and group context. It verifies the complete MLS roster against
the authenticated device directory after every membership commit.

The client durably stages candidate state before submitting commits and the
application message. The server accepts the complete batch only at its expected
revision. An operation ID makes retries idempotent. On interruption, the client
settles the operation transactionally: accepted state is promoted; a cancelled
operation cannot be accepted by a delayed network request. Conflicting sends
sync and retry with fresh update-path secrets. Secret-tree state and cached
media descriptors advance together in one encrypted local record.
Joining also durably records private KeyPackage retirement, so deletion and
Welcome acknowledgment resume after interruption even when the cursor advanced.

Only private-state operations hold the device queue. Compression, attachment
encryption, downloads, and decryption run outside it; resuming state work and
displaying downloaded media verify that the account and device still match.

Group membership and device changes are enforced before the next encrypted
send. New members cannot decrypt old epochs. A new device without a Welcome can send without an existing device online:
preparation retires the active session and creates a replacement for future
whisps. The sender invites the registered devices using their published
KeyPackages. Subsequent sends reuse that session. Existing drafts that have
already joined keep their original session, and old deliveries still resolve
to their original ciphertext log. Recovery does not grant access to past epochs.
Losing all private device state still prevents decrypting past whisps.

## Opening and send performance

Opening always reauthorizes the delivery with the server. If the descriptor is
already in authenticated private storage, it does not resync the conversation.
Registration and key maintenance coalesce outside the ratchet lease. Only local
private-state changes and ordered MLS synchronization hold that lease. The HTTP
transport shares connections without sharing account cookies, and unchanged
conversation sync avoids rewriting snapshots. Sync includes descriptor retention
IDs, with a fallback to the separate retention endpoint. Deploy the API before
the updated mobile client: delivery authorization now includes the message ID,
and the client rejects missing or mismatched IDs before using a cached descriptor.

Focused direct and group inboxes prefetch at most three ciphertext files, up to
32 MiB each, for two minutes. Explicit opens reuse those transfers and may download
larger files. Prefetch never decrypts, authorizes a view, or sends read receipts.
Files are removed after use, account changes, eviction, or restart. Native send
status events wake foreground reconciliation immediately, with a 30-second
recovery poll (older native binaries keep their two-second polling fallback).

Run `cargo run --release --manifest-path rust/Cargo.toml --example media_benchmark`
from this package for reproducible attachment timings. These measure local crypto
and file I/O, not server latency, compression, upload, or download time.

## Native send jobs

JavaScript enqueues a captured file and observes the persistent outbox. An Expo
module hands it to Android WorkManager or an iOS native queue with BGProcessing
recovery. Kotlin/Swift compress images to oriented JPEG and videos to MP4. Failed
compression preserves the job instead of mislabelling the original file.

Rust owns the encrypted job journal, attachment encryption, conversation sync,
MLS publication, upload authorization, and delivery confirmation. Foreground
receives use the same Rust conversation implementation. An OS file lock guards
shared ratchet state across JSI and background workers; media work stays outside
that lock. Android loads one shared Rust library through JSI and UniFFI/JNA.

Each job copies and flushes its source before enqueue succeeds. Checkpoints
survive process death. Draft creation uses the job's stable ID; recovery settles
pending commits and checks published receipts before appending. Plaintext is
removed after ciphertext and its key are durable. Jobs still awaiting publication
expire after 24 hours. Uploading jobs first reconcile delivery, so a lost response
does not turn a delivered whisp into a failure. Missing or expired server drafts
become terminal failures. Recovery removes incomplete enqueue directories under
their job locks, without deleting a source copy still in progress. Completed jobs and ciphertext are removed after the app
observes their terminal status. Optional thumbhashes are not generated by the
native sender yet.

Android streams transfers inside a foreground WorkManager worker. iOS uses a
background URLSession and persists completion receipts independently of unlocked
MLS credentials. Native credentials are held in Android Keystore-encrypted
preferences or a device-only, when-unlocked iOS Keychain item. Sign-in refreshes
the worker configuration. Logout pauses preparation. A transfer already handed
to the OS can finish, with its receipt reconciled when that account returns.

Native workers consume generated UniFFI command enums and job records. Only the
Expo/vault and journal boundaries serialize JSON. Blocking Expo methods run on
dedicated executors, never Expo's shared async-function queue. Android serializes
compression globally and each individual job separately; independent transfers
can run concurrently without holding the MLS device lease.

Failures have explicit retry, blocked, or terminal dispositions. Connection
failures and commit conflicts retry automatically. Missing keys, authorization
problems, and compression failures retain their recovery reason and wait for
foreground resume; expiry still applies. Terminal reasons reach the outbox.
Foreground key maintenance retries every minute and on activation, and opening
media checks key inventory too. iOS also retries transient failures and pending
confirmations while foregrounded, without waiting for BGProcessing.

Retries do not require JavaScript, but execution remains subject to OS scheduling.
iOS preparation pauses while protected keys are locked. Force-quitting iOS can
prevent background work until the app is reopened. Relaunch resumes the durable
queue; it does not depend on an in-memory upload promise.

## Storage and media

- The device storage key is held in Expo SecureStore with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` on iOS. MLS snapshots and pending operations
  are encrypted with age and written using fsync, atomic rename, and directory
  fsync. Private KeyPackages are persisted before their public halves are sent.
  Android backups are disabled; iOS excludes the MLS state directory from backup.
- Attachments use the age v1 authenticated streaming file format, in a native
  worker with bounded memory. Files are published for viewing only after
  authentication reaches EOF. Tampering and truncation fail closed.
- UploadThing receives ciphertext and an opaque draft ID. The API requires a
  sealed application message in every target conversation and rechecks the
  encryption-time recipient/device roster at upload completion. Callback retries
  cannot replace a file already attached to a message.
- The viewer decrypts into a private temporary file and acknowledges reading
  only after successful image display or video readiness. Closing or backgrounding
  the viewer removes temporary plaintext. Startup removes crash leftovers.
  Consumed descriptors and KeyPackages are retired locally; retained-message and
  retained-key queries also clean up keys consumed on another device.
- Push notifications contain navigation references, without media URLs or
  thumbhashes. Sender/group identity, timing, ciphertext size, and social graph
  remain server-visible metadata.

Device keys are immutable and account-bound by the authenticated server.
Clients pin device/account/public-key bindings on first use. This currently
trusts the directory to introduce new devices. It does not provide key
transparency or independently verified safety numbers. A malicious directory
can introduce a new device, and a compromised account can register one.
This integration has not had an independent security audit.

Profile exposes device revocation and a confirmed local encryption reset. Revocation prevents future delivery;
it cannot recall content a device already received. Reinstallation creates a
new identity and cannot recover old whisps. Existing plaintext whisps are
explicitly treated as legacy, because they cannot be retroactively encrypted.
New sends never fall back to plaintext, including when a recipient has no keys.

## Build and rollout

Requirements: Bun, Node, Rust 1.91+, and the platform's native tools.
Generated TypeScript/C++/Kotlin/Swift bindings and native binaries are ignored build outputs.
The root postinstall hook builds these on EAS before prebuild/pods (Rust 1.94.0,
cargo-ndk 4.1.2 on Android). Platformless EAS fingerprint and update jobs generate
TypeScript/C++ bindings using a host Rust build, without mobile SDKs. The hook
does nothing during local installs. Local Expo
`android` and `ios` scripts also build the MLS library before invoking Expo.

```sh
bun install --frozen-lockfile
bun run --cwd packages/react-native-whisp-mls bindings
bun run --cwd packages/react-native-whisp-mls test
```

Android:

```sh
rustup target add armv7-linux-androideabi aarch64-linux-android i686-linux-android x86_64-linux-android
cargo install cargo-ndk --version 4.1.2 --locked
# Set ANDROID_HOME and ANDROID_NDK_HOME.
bun run --cwd packages/react-native-whisp-mls build:android
bun run --cwd apps/expo android
```

iOS, on macOS with Xcode:

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
bun run --cwd packages/react-native-whisp-mls build:ios
bun run --cwd apps/expo ios
```

Use a rebuilt Expo client. Expo Go and older native builds cannot encrypt or
open MLS whisps. Android prebuild requires the project's `google-services.json`
or `GOOGLE_SERVICES_JSON`. iOS builds produce the XCFramework referenced by
the podspec. The development-only Profile bridge test remains a local diagnostic.

The deployment migration runner applies `packages/db/drizzle/0002_mls.sql`
before building the API. It adds the MLS tables through the registered Drizzle
history. Local databases use `bun db:migrate`. Coordinate native-client and
server releases: the upload route
rejects old plaintext clients, and recipients need to open the new app to
register devices before anyone can send them an encrypted whisp.

The conversation ciphertext log is retained for offline epoch catch-up. Media
drafts and delivery records follow the existing cleanup lifecycle. Do not delete
log entries while devices may still need them; bounded archival requires a
separate device-expiration policy. Normal local file deletion does not promise
forensic erasure on flash storage. Do not restore MLS state from old backups.

Before release, exercise two physical devices through photo/video sends, offline
catch-up, simultaneous sends, process death during append/upload, group changes,
revocation, and reinstall. Linux checks cannot validate iOS or replace these
native runtime checks. Review the app-store encryption declaration for this
new native cryptography use.

References: [OpenMLS](https://github.com/openmls/openmls),
[UniFFI React Native](https://github.com/jhugman/uniffi-bindgen-react-native),
[SkyChat](https://github.com/fossephate/skychat), and
[XMTP Expo module](https://github.com/xmtp/xmtp-react-native).

## Lifecycle design references

These are implementation references, not additional runtime dependencies:

- [Signal view-once completion and linked-device sync](https://github.com/signalapp/Signal-iOS/blob/e5ea0729afc64261119ef232d4b00e8f48f53d3e/SignalServiceKit/Util/ViewOnceMessages.swift): explicit content retirement and durable opened notifications. Whisp retains its existing acknowledgment-after-display policy.
- [Signal attachment uploads](https://github.com/signalapp/Signal-Android/blob/7b67f2b3ee88c8319c6093afdbde4137bfd91a9a/app/src/main/java/org/thoughtcrime/securesms/jobs/AttachmentUploadJob.kt): persisted jobs, bounded lifetime, and selective retries. Signal's iOS uploader also serializes by upload identity instead of holding a global transfer lock.
- [Wire MLS lifecycle](https://github.com/wireapp/wire-ios/blob/8bdbb227563cf17536fb83b83651f79020b31a08/wire-ios-data-model/Source/MLS/MLSService.swift): recurring KeyPackage maintenance and recovery selected by failure type.
- [Matrix Rust send queue](https://github.com/matrix-org/matrix-rust-sdk/blob/40f1b540a31d05fe7c08d0816c66c95dc93c18cf/crates/matrix-sdk/src/send_queue/mod.rs): persistent work, observable failures, and blocked requests that require explicit retry. Whisp retains its existing draft/MLS/upload protocol.
