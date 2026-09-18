import { MlsClient, MlsError, ReceivedMessage } from "./generated/whisp_mls";
import { initializeMls } from "./initialize";

export type MlsSmokeTestResult =
  | { status: "passed"; checks: string[] }
  | { status: "failed"; message: string };

// Small fixed bytes exercise binary transport without depending on a TextEncoder polyfill.
const payload = Uint8Array.of(0, 1, 2, 127, 128, 255).buffer;

function verifyMessage(message: ReceivedMessage, sender: string) {
  if (!ReceivedMessage.Application.instanceOf(message)) {
    throw new Error("Expected an encrypted application message.");
  }
  const expected = new Uint8Array(payload);
  const actual = new Uint8Array(message.inner.plaintext);
  if (
    message.inner.sender !== sender ||
    actual.length !== expected.length ||
    actual.some((byte, index) => byte !== expected[index])
  ) {
    throw new Error(
      "The decrypted bytes or authenticated sender did not match.",
    );
  }
}

function verifyRejected(operation: () => unknown) {
  try {
    operation();
  } catch (error: unknown) {
    if (MlsError.Protocol.instanceOf(error)) return;
    throw error;
  }
  throw new Error("MLS accepted a message that should have been rejected.");
}

/** Local test participants only. No account, network, media, or persistent storage is used. */
export function runMlsSmokeTest(): MlsSmokeTestResult {
  const clients: MlsClient[] = [];
  try {
    initializeMls();
    const alice = new MlsClient("test-alice");
    clients.push(alice);
    const bob = new MlsClient("test-bob");
    clients.push(bob);
    const charlie = new MlsClient("test-charlie");
    clients.push(charlie);
    alice.createGroup(Uint8Array.of(1, 2, 3).buffer);
    bob.joinGroup(alice.addMember(bob.keyPackage()).welcome);
    const ciphertext = alice.encrypt(payload);
    verifyMessage(bob.process(ciphertext), "test-alice");
    verifyRejected(() => bob.process(ciphertext));
    verifyMessage(alice.process(bob.encrypt(payload)), "test-bob");

    const invitation = alice.addMember(charlie.keyPackage());
    bob.process(invitation.commit);
    charlie.joinGroup(invitation.welcome);
    const shared = alice.encrypt(payload);
    verifyMessage(bob.process(shared), "test-alice");
    verifyMessage(charlie.process(shared), "test-alice");

    const removal = alice.removeMember("test-charlie");
    bob.process(removal);
    const afterRemoval = alice.encrypt(payload);
    verifyRejected(() => charlie.process(afterRemoval));
    verifyMessage(bob.process(afterRemoval), "test-alice");
    if (!ReceivedMessage.Removed.instanceOf(charlie.process(removal))) {
      throw new Error("The removed client did not acknowledge its removal.");
    }

    return {
      status: "passed",
      checks: [
        "Two clients exchanged authenticated binary messages",
        "Replayed ciphertext was rejected",
        "A third client joined and decrypted a group message",
        "The removed client could not decrypt new messages",
        "The remaining client still decrypted new messages",
      ],
    };
  } catch (error: unknown) {
    return {
      status: "failed",
      message:
        error instanceof Error
          ? error.message
          : "The MLS bridge test failed without an error description. Rebuild the native module and retry.",
    };
  } finally {
    for (const client of clients) client.uniffiDestroy();
  }
}
