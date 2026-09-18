import { createTRPCClient, TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod/v4";

import type { AppRouter } from "@acme/api";

// Exercise the real client orchestration and serialization queue. Native crypto
// and platform storage are boundaries here; Rust tests cover their real behavior.
const files = new Map<string, string>();
const secure = new Map<string, string>();
const encode = (text: string): ArrayBuffer =>
  new TextEncoder().encode(text).buffer;
const decode = (bytes: ArrayBuffer) => new TextDecoder().decode(bytes);
const signatureKey = Buffer.alloc(32, 1).toString("base64");
const conversationId = crypto.randomUUID();
const messageId = crypto.randomUUID();
const nativeState = z.object({ deviceId: z.string(), groupId: z.string() });
let userId = "alice";
let descriptors: Record<string, unknown> = {};
let nativeEnqueue: () => Promise<string> = async () => messageId;
let download: () => Promise<void> = async () => {};
let handlers: Record<string, (input: unknown) => unknown> = {};

class NativeClient {
  groupIdValue = "";
  constructor(readonly deviceId: string) {}
  static restoreState(bytes: ArrayBuffer) {
    const saved = nativeState.parse(JSON.parse(decode(bytes)));
    const client = new NativeClient(saved.deviceId);
    client.groupIdValue = saved.groupId;
    return client;
  }
  exportState() {
    return encode(
      JSON.stringify({ deviceId: this.deviceId, groupId: this.groupIdValue }),
    );
  }
  createGroup(groupId: ArrayBuffer) {
    this.groupIdValue = decode(groupId);
  }
  joinGroup() {
    this.groupIdValue = conversationId;
  }
  groupId() {
    return encode(this.groupIdValue);
  }
  members() {
    return [
      {
        deviceId: this.deviceId,
        signatureKey: new Uint8Array(32).fill(1).buffer,
      },
    ];
  }
  signatureKey() {
    return new Uint8Array(32).fill(1).buffer;
  }
  updateKeys() {
    return encode("commit");
  }
  encrypt(plaintext: ArrayBuffer) {
    return plaintext;
  }
  uniffiDestroy() {}
}

const api = createTRPCClient<AppRouter>({
  links: [
    () =>
      ({ op }) =>
        observable((observer) => {
          void Promise.resolve()
            .then(() => {
              const handler = handlers[op.path];
              if (!handler) throw new Error(`Unexpected API call: ${op.path}`);
              return handler(op.input);
            })
            .then((data) => {
              observer.next({ result: { data } });
              observer.complete();
            })
            .catch((error: unknown) =>
              observer.error(
                TRPCClientError.from(
                  error instanceof Error ? error : new Error(String(error)),
                ),
              ),
            );
        }),
  ],
});
mock.module("./api", () => ({ createExpoTRPCClient: () => api }));
mock.module("./auth", () => ({
  authClient: {
    getCookie: () => `session-${userId}`,
    getSession: async () => ({ data: { user: { id: userId } } }),
  },
}));
mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    secure.set(key, value);
  },
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
}));
mock.module("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  cacheDirectory: "file:///cache/",
  makeDirectoryAsync: async () => {},
  getInfoAsync: async (path: string) => ({
    exists: files.has(path),
    uri: path,
    size: 100,
    modificationTime: Date.now() / 1000,
  }),
  readAsStringAsync: async (path: string) => {
    const value = files.get(path);
    if (value === undefined) throw new Error(`Missing file: ${path}`);
    return value;
  },
  readDirectoryAsync: async () => [],
  deleteAsync: async (path: string) => {
    files.delete(path);
  },
  downloadAsync: async (_url: string, path: string) => {
    await download();
    files.set(path, "ciphertext");
    return { status: 200 };
  },
}));
mock.module("react-native-whisp-mls", () => ({
  syncNativeConversation: async () => JSON.stringify(descriptors),
  forgetNativeDescriptor: async (
    _config: string,
    _conversation: string,
    id: string,
  ) => {
    delete descriptors[id];
  },
  MlsClient: NativeClient,
  acquireDeviceLease: async () => ({ release: () => {} }),
  nativeSend: { configure: async () => {}, enqueue: () => nativeEnqueue() },
  ReceivedMessage: {},
  initializeMls: () => {},
  generateStorageKey: () => "storage-key",
  newId: () => crypto.randomUUID(),
  utf8Encode: encode,
  utf8Decode: decode,
  encodeBase64: (bytes: ArrayBuffer) => Buffer.from(bytes).toString("base64"),
  decodeBase64: (text: string) =>
    Uint8Array.from(Buffer.from(text, "base64")).buffer,
  sealLocal: encode,
  openLocal: decode,
  writePrivateFile: (path: string, text: string) => {
    files.set(`file://${path}`, text);
  },
  encryptAttachment: async (_input: string, path: string) => {
    files.set(`file://${path}`, "ciphertext");
    return "media-key";
  },
  decryptAttachment: async (_input: string, path: string) => {
    files.set(`file://${path}`, "plaintext");
  },
}));
mock.module("./base-url", () => ({ getBaseUrl: () => "https://whisp.test" }));
const { withEncryptionDevice } = await import("./mls-device");
const { openWhisp } = await import("./mls-media");

const { enqueueNativeSend } = await import("./native-send");

beforeEach(() => {
  files.clear();
  secure.clear();
  userId = "alice";
  descriptors = {};
  nativeEnqueue = async () => messageId;
  download = async () => {};
  handlers = {
    "mls.register": () => ({ ok: true }),
    "mls.inventory": () =>
      Array.from({ length: 32 }, () => crypto.randomUUID()),
    "mls.retainedKeys": () => [],
    "mls.retainedMessages": () => [messageId],
  };
});
afterAll(() => mock.restore());

const descriptor = {
  version: 1,
  messageId,
  senderId: "alice",
  groupId: null,
  key: "media-key",
  mimeType: "video/mp4",
} as const;
const message = {
  messageId,
  deliveryId: "delivery",
  senderId: "alice",
  fileUrl: "https://example.com/ciphertext",
  mimeType: "application/vnd.whisp.mls.v1",
};
async function selfConversation() {
  const device = await withEncryptionDevice(async (current) => current);
  let revision = 0;
  handlers["mls.prepare"] = () => ({
    draftId: messageId,
    conversations: [{ id: conversationId }],
  });
  handlers["mls.sync"] = () => ({
    conversation: { revision },
    welcome: null,
    events: [],
  });
  handlers["mls.begin"] = () => ({
    operationId: crypto.randomUUID(),
    members: [{ deviceId: device.deviceId, userId: "alice", signatureKey }],
    packages: [],
  });
  handlers["mls.append"] = () => {
    revision += 2;
    return { revision };
  };
  handlers["mls.settle"] = () => ({ revision });
  handlers["mls.delivery"] = () => ({
    kind: "mls",
    conversationId,
    groupId: null,
  });
  handlers["messages.markRead"] = () => ({ ok: true });
  handlers["messages.cleanupIfAllRead"] = () => ({ ok: true });
  return device;
}
const noop = () => {};
function gate() {
  let release = noop;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function seedDescriptor() {
  descriptors[messageId] = descriptor;
}

test("native enqueue does not hold the foreground device lock", async () => {
  await selfConversation();
  const entered = gate();
  const blocked = gate();
  nativeEnqueue = async () => {
    entered.release();
    await blocked.promise;
    return messageId;
  };
  const sending = enqueueNativeSend({
    uri: "file:///source.mp4",
    type: "video",
    recipients: ["alice"],
  });
  await entered.promise;
  try {
    expect(
      await Promise.race([
        withEncryptionDevice(async () => "available"),
        delay(100).then(() => "blocked"),
      ]),
    ).toBe("available");
  } finally {
    blocked.release();
    await sending;
  }
});

test("a pending download does not block another viewer's read receipt", async () => {
  await selfConversation();
  await seedDescriptor();
  const first = await openWhisp(message);
  const entered = gate();
  const blocked = gate();
  download = async () => {
    entered.release();
    await blocked.promise;
  };
  const opening = openWhisp(message);
  await entered.promise;
  try {
    expect(
      await Promise.race([
        first.acknowledge().then(() => "read"),
        delay(100).then(() => "blocked"),
      ]),
    ).toBe("read");
  } finally {
    blocked.release();
    await (await opening).dispose();
    await first.dispose();
  }
});

for (const change of ["account", "device"] as const) {
  test(`changing ${change} during download discards plaintext and does not mark it read`, async () => {
    const original = await selfConversation();
    await seedDescriptor();
    const entered = gate();
    const blocked = gate();
    download = async () => {
      entered.release();
      await blocked.promise;
    };
    let receipts = 0;
    handlers["messages.markRead"] = () => {
      receipts++;
      return { ok: true };
    };
    const opening = openWhisp(message);
    await entered.promise;
    if (change === "account") userId = "bob";
    else
      files.set(
        `${original.root}device.json`,
        JSON.stringify({ deviceId: crypto.randomUUID() }),
      );
    blocked.release();
    await expect(opening).rejects.toThrow(
      "account or encryption device changed",
    );
    expect(receipts).toBe(0);
    expect([...files.values()]).not.toContain("plaintext");
  });
}

test("legacy close waits for the read receipt before one remote cleanup", async () => {
  await selfConversation();
  handlers["mls.delivery"] = () => ({ kind: "legacy" });
  const blocked = gate();
  const entered = gate();
  let cleanups = 0;
  handlers["messages.markRead"] = async () => {
    entered.release();
    await blocked.promise;
    return { ok: true };
  };
  handlers["messages.cleanupIfAllRead"] = () => {
    cleanups++;
    return { ok: true };
  };
  const opened = await openWhisp({ ...message, mimeType: "video/quicktime" });
  const receipt = opened.acknowledge();
  await entered.promise;
  const disposal = opened.dispose();
  expect(cleanups).toBe(0);
  blocked.release();
  await Promise.all([receipt, disposal, opened.dispose()]);
  expect(cleanups).toBe(1);
  expect(opened.mimeType).toBe("video/quicktime");
});
