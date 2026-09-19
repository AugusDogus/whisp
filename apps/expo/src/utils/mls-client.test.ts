import type { SendJob } from "./native-send";

import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod/v4";

import type { AppRouter } from "@acme/api";

import { getOutboxStatusSnapshot } from "./outbox-status";

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
let signedOut = false;
let sessionError: { message: string } | null = null;
let nativeConfigurations: (string | null)[] = [];
let nativeJobs: SendJob[] = [];
let acknowledgedJobs: string[] = [];
const notices: { error: string[]; info: string[]; success: string[] } = {
  error: [],
  info: [],
  success: [],
};
mock.module("sonner-native", () => ({
  toast: {
    error: (message: string) => notices.error.push(message),
    info: (message: string) => notices.info.push(message),
    success: (message: string) => notices.success.push(message),
  },
}));
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
  keyPackage() {
    return encode("key package");
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
// Module mocks outlive mock.restore(). Preserve shared exports and restore these
// boundaries so account-cache tests also work when they run after this file.
const originalApi = { ...(await import("./api")) };
const originalAuth = { ...(await import("./auth")) };
const originalBaseUrl = { ...(await import("./base-url")) };
mock.module("./api", () => ({
  ...originalApi,
  createExpoTRPCClient: () => api,
}));
mock.module("./auth", () => ({
  authClient: {
    ...originalAuth.authClient,
    getCookie: () => (signedOut ? null : `session-${userId}`),
    getSession: async () => ({
      data: signedOut || sessionError ? null : { user: { id: userId } },
      error: sessionError,
    }),
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
  nativeSend: {
    list: async () => JSON.stringify(nativeJobs),
    acknowledge: async (id: string) => {
      acknowledgedJobs.push(id);
    },
    configure: async (config: string | null) => {
      nativeConfigurations.push(config);
    },
    enqueue: () => nativeEnqueue(),
  },
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
const { withEncryptionDevice, prepareEncryptionDevice } =
  await import("./mls-device");
const { openWhisp } = await import("./mls-media");

const { enqueueNativeSend, configureNativeSends } =
  await import("./native-send");
const { reconcileNativeSends } = await import("./media-upload");

beforeEach(() => {
  files.clear();
  secure.clear();
  userId = "alice";
  signedOut = false;
  sessionError = null;
  nativeConfigurations = [];
  nativeJobs = [];
  acknowledgedJobs = [];
  notices.error.length = notices.info.length = notices.success.length = 0;
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
afterAll(() => {
  mock.restore();
  mock.module("./api", () => originalApi);
  mock.module("./auth", () => originalAuth);
  mock.module("./base-url", () => originalBaseUrl);
});

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

test("opening a whisp replenishes keys after offline provisioning failed", async () => {
  await selfConversation();
  handlers["mls.inventory"] = () => {
    throw new Error("offline");
  };
  await expect(prepareEncryptionDevice()).rejects.toThrow("offline");
  let published = 0;
  handlers["mls.inventory"] = () => [];
  handlers["mls.publish"] = (input) => {
    const parsed = z
      .object({ packages: z.array(z.object({ id: z.string() })) })
      .parse(input);
    published += parsed.packages.length;
    for (const key of parsed.packages) {
      expect(
        [...files.keys()].some((path) =>
          path.endsWith(`/packages/${key.id}.age`),
        ),
      ).toBe(true);
    }
    return { ok: true };
  };
  await seedDescriptor();
  const opened = await openWhisp(message);
  expect(published).toBe(32);
  await opened.dispose();
});

test("a transient sign-in check failure preserves native worker configuration", async () => {
  await configureNativeSends();
  expect(nativeConfigurations).toHaveLength(1);
  sessionError = { message: "offline" };
  await expect(configureNativeSends()).rejects.toThrow(
    "Queued sends are preserved",
  );
  expect(nativeConfigurations).toHaveLength(1);
});

test("signing out clears native configuration even when session lookup fails", async () => {
  await configureNativeSends();
  signedOut = true;
  sessionError = { message: "offline" };
  await configureNativeSends();
  expect(nativeConfigurations.at(-1)).toBeNull();
});

function queuedSend(
  status: SendJob["status"],
  error: string | null,
): SendJob & { recipients: [string] } {
  return {
    id: crypto.randomUUID(),
    kind: "photo",
    recipients: [crypto.randomUUID()],
    groupId: null,
    status,
    error,
    createdAt: Date.now(),
  };
}

test("interrupted sends stay pending until automatic recovery reports delivery", async () => {
  const client = new QueryClient();
  const job = queuedSend("uploading", "Connection lost. Whisp will retry.");
  nativeJobs = [job];
  await reconcileNativeSends(client);
  expect(getOutboxStatusSnapshot()[job.recipients[0]]?.state).toBe("retrying");
  expect(notices.error).toEqual([]);
  expect(acknowledgedJobs).toEqual([]);
  nativeJobs = [{ ...job, status: "sent", error: null }];
  await reconcileNativeSends(client);
  expect(getOutboxStatusSnapshot()[job.recipients[0]]?.state).toBe("sent");
  expect(acknowledgedJobs).toEqual([job.id]);
  client.clear();
});

test("blocked sends stay paused and keep their recovery reason", async () => {
  const client = new QueryClient();
  const reason = "Ask the recipient to open Whisp, then reopen Whisp to retry.";
  const job = queuedSend("blocked", reason);
  nativeJobs = [job];
  await reconcileNativeSends(client);
  await reconcileNativeSends(client);
  expect(getOutboxStatusSnapshot()[job.recipients[0]]?.state).toBe("blocked");
  expect(notices.info).toEqual([reason]);
  expect(notices.error).toEqual([]);
  expect(acknowledgedJobs).toEqual([]);
  client.clear();
});

test("terminal send failures are reported and acknowledged", async () => {
  const client = new QueryClient();
  const reason = "The whisp expired. Capture it again.";
  const job = queuedSend("failed", reason);
  nativeJobs = [job];
  await reconcileNativeSends(client);
  expect(getOutboxStatusSnapshot()[job.recipients[0]]?.state).toBe("failed");
  expect(notices.error).toEqual([reason]);
  expect(acknowledgedJobs).toEqual([job.id]);
  client.clear();
});
