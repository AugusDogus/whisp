import type { SendJob } from "./native-send";

import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod/v4";

import type { AppRouter } from "@acme/api";

import type { InboxMessage } from "~/components/friends/types";

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
let sessionReads = 0;
let nativeSyncs = 0;
let cachedDescriptors: Record<string, unknown> = {};
let apiCalls: string[] = [];
let nativeConfigurations: (string | null)[] = [];
let nativeJobs: SendJob[] = [];
let acknowledgedJobs: string[] = [];
let onAcknowledge = () => {};
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
let syncDescriptors = async () => JSON.stringify(descriptors);
let nativeEnqueue: () => Promise<string> = async () => messageId;
let download: () => Promise<void> = async () => {};
let disposedDownloads = 0;
let handlers: Record<string, (input: unknown) => unknown> = {};

class NativeTransportError extends Error {
  static instanceOf(error: unknown): error is NativeTransportError {
    return error instanceof NativeTransportError;
  }
}
class NativeRequestError extends Error {
  constructor(readonly inner: { status: number }) {
    super("Native request failed");
  }
  static instanceOf(error: unknown): error is NativeRequestError {
    return error instanceof NativeRequestError;
  }
}

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
              apiCalls.push(op.path);
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
    getSession: async () => {
      sessionReads++;
      return {
        data: signedOut || sessionError ? null : { user: { id: userId } },
        error: sessionError,
      };
    },
  },
}));
mock.module("expo-device", () => ({
  modelName: "Pixel 8 Pro",
  osName: "Android",
}));
mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    secure.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    secure.delete(key);
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
    if (path.endsWith("/"))
      for (const name of files.keys())
        if (name.startsWith(path)) files.delete(name);
  },
  downloadAsync: async (_url: string, path: string) => {
    await download();
    files.set(path, "ciphertext");
    return { status: 200 };
  },
  createDownloadResumable: (_url: string, path: string) => ({
    cancelAsync: async () => {
      disposedDownloads++;
    },
    downloadAsync: async () => {
      await download();
      files.set(path, "ciphertext");
      return { status: 200, uri: path };
    },
  }),
}));
mock.module("react-native-whisp-mls", () => ({
  MlsError: {
    instanceOf: (error: unknown) =>
      error instanceof NativeTransportError ||
      error instanceof NativeRequestError,
    Transport: NativeTransportError,
    Request: NativeRequestError,
  },
  readNativeDescriptor: async (
    _config: string,
    _conversation: string,
    id: string,
  ) => {
    const cached = cachedDescriptors[id];
    return cached === undefined ? undefined : JSON.stringify(cached);
  },
  syncNativeConversation: () => {
    nativeSyncs++;
    return syncDescriptors();
  },
  forgetNativeDescriptor: async (
    _config: string,
    _conversation: string,
    id: string,
  ) => {
    delete descriptors[id];
    delete cachedDescriptors[id];
  },
  MlsClient: NativeClient,
  acquireDeviceLease: async () => ({ release: () => {} }),
  nativeSend: {
    list: async () => JSON.stringify(nativeJobs),
    acknowledge: async (id: string) => {
      acknowledgedJobs.push(id);
      onAcknowledge();
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
const {
  withEncryptionDevice,
  prepareEncryptionDevice,
  registerDevice,
  resetEncryptionDevice,
} = await import("./mls-device");
const { openWhisp, readWhispMediaKind, retryWhispMediaKind } =
  await import("./mls-media");
const { useInboxMediaKinds } = await import("~/hooks/useInboxMediaKinds");

const { enqueueNativeSend, configureNativeSends } =
  await import("./native-send");
const { reconcileNativeSends } = await import("./media-upload");

beforeEach(() => {
  files.clear();
  secure.clear();
  userId = "alice";
  signedOut = false;
  sessionError = null;
  sessionReads = 0;
  nativeSyncs = 0;
  cachedDescriptors = {};
  apiCalls = [];
  nativeConfigurations = [];
  nativeJobs = [];
  acknowledgedJobs = [];
  onAcknowledge = () => {};
  notices.error.length = notices.info.length = notices.success.length = 0;
  descriptors = {};
  syncDescriptors = async () => JSON.stringify(descriptors);
  nativeEnqueue = async () => messageId;
  download = async () => {};
  disposedDownloads = 0;
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

test("device provisioning registers the phone model without personal device names", async () => {
  const registrations: unknown[] = [];
  handlers["mls.register"] = (input) => {
    registrations.push(input);
    return { ok: true };
  };
  await prepareEncryptionDevice();
  expect(registrations).toHaveLength(1);
  expect(registrations[0]).toMatchObject({ name: "Pixel 8 Pro", signatureKey });
});

for (const operation of [
  "mls.register",
  "mls.inventory",
  "mls.publish",
] as const) {
  test(`key maintenance releases the private-state lease during ${operation}`, async () => {
    const blocked = gate();
    const entered = gate();
    handlers["mls.inventory"] = () => [];
    handlers["mls.publish"] = () => ({ ok: true });
    const original = handlers[operation];
    handlers[operation] = async (input) => {
      entered.release();
      await blocked.promise;
      return original?.(input);
    };
    const preparing = prepareEncryptionDevice();
    expect(prepareEncryptionDevice()).toBe(preparing);
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
      await preparing;
    }
    expect(apiCalls.filter((path) => path === operation)).toHaveLength(1);
  });
}

for (const change of ["account", "device"] as const) {
  test(`key maintenance does not publish after changing ${change}`, async () => {
    const device = await withEncryptionDevice(async (current) => current);
    const blocked = gate();
    const entered = gate();
    handlers["mls.inventory"] = async () => {
      entered.release();
      await blocked.promise;
      return [];
    };
    const preparing = prepareEncryptionDevice();
    await entered.promise;
    if (change === "account") userId = "bob";
    else
      files.set(
        `${device.root}device.json`,
        JSON.stringify({ deviceId: crypto.randomUUID() }),
      );
    blocked.release();
    await expect(preparing).rejects.toThrow(
      "account or encryption device changed",
    );
    expect(apiCalls).not.toContain("mls.publish");
  });
}

test("reset provisions a new device without reusing interrupted maintenance", async () => {
  const device = await withEncryptionDevice(async (current) => current);
  const entered = gate();
  const blocked = gate();
  let calls = 0;
  handlers["mls.inventory"] = async () => {
    if (++calls === 1) {
      entered.release();
      await blocked.promise;
    }
    return Array.from({ length: 32 }, () => crypto.randomUUID());
  };
  handlers["mls.revoke"] = () => ({ ok: true });
  const preparing = prepareEncryptionDevice();
  const failed = preparing.then(
    () => null,
    (error: unknown) => error,
  );
  await entered.promise;
  try {
    await resetEncryptionDevice();
    const current = await withEncryptionDevice(async (value) => value);
    expect(current.deviceId).not.toBe(device.deviceId);
    expect(calls).toBe(2);
  } finally {
    blocked.release();
    expect(await failed).toBeInstanceOf(Error);
  }
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
  await registerDevice(device);
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
    messageId,
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

for (const scenario of [
  "arrival",
  "return from send",
  "cancel and return",
  "network recovers",
  "native network recovers",
] as const) {
  test(`inbox media types update without refresh after ${scenario}`, async () => {
    await selfConversation();
    await seedDescriptor();
    const blocked = gate();
    let syncAttempts = 0;
    syncDescriptors = async () => {
      if (scenario === "native network recovers" && ++syncAttempts <= 3)
        throw new NativeTransportError();
      await blocked.promise;
      return JSON.stringify(descriptors);
    };
    if (scenario === "network recovers") {
      let attempts = 0;
      const delivery = handlers["mls.delivery"];
      handlers["mls.delivery"] = (input) => {
        if (++attempts <= 3) throw new TypeError("Network request failed");
        return delivery?.(input);
      };
    }
    const client = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    let result: ReturnType<typeof useInboxMediaKinds> | undefined;
    let renderer: ReactTestRenderer | undefined;
    function Harness({
      inbox,
      enabled,
    }: {
      inbox: InboxMessage[];
      enabled: boolean;
    }) {
      result = useInboxMediaKinds(inbox, enabled);
      return null;
    }
    function render(inbox: InboxMessage[], enabled = true) {
      return createElement(
        QueryClientProvider,
        { client },
        createElement(Harness, { inbox, enabled }),
      );
    }
    try {
      await act(async () => {
        renderer = create(render([]));
      });
      const inbox: InboxMessage[] = [
        {
          ...message,
          createdAt: new Date(),
          groupId: undefined,
          thumbhash: undefined,
        },
      ];
      await act(async () => {
        renderer?.update(render(inbox, scenario !== "return from send"));
      });
      if (scenario === "cancel and return") {
        await act(async () => renderer?.update(render(inbox, false)));
      }
      await act(async () => renderer?.update(render(inbox)));
      expect(result?.mediaKinds.size).toBe(0);
      await act(async () => {
        blocked.release();
        await delay(50);
      });
      expect(result?.mediaKinds.get(message.deliveryId)).toBe("video");
    } finally {
      blocked.release();
      await act(async () => renderer?.unmount());
      client.clear();
    }
  });
}

test("metadata keeps retrying transient requests but stops on permanent failures", () => {
  for (const status of [408, 429, 500, 503]) {
    expect(retryWhispMediaKind(10, new NativeRequestError({ status }))).toBe(
      true,
    );
    expect(
      retryWhispMediaKind(
        10,
        new TRPCClientError("Request failed", {
          meta: { response: new Response(null, { status }) },
        }),
      ),
    ).toBe(true);
  }
  for (const status of [400, 401, 403, 404]) {
    expect(retryWhispMediaKind(1, new NativeRequestError({ status }))).toBe(
      false,
    );
    expect(
      retryWhispMediaKind(
        1,
        new TRPCClientError("Request rejected", {
          meta: { response: new Response(null, { status }) },
        }),
      ),
    ).toBe(false);
  }
  expect(retryWhispMediaKind(1, new Error("Invalid media key"))).toBe(false);
});

test("inbox metadata resolves photo and video types without consuming the whisp", async () => {
  await selfConversation();
  let downloads = 0;
  let receipts = 0;
  let cleanups = 0;
  download = async () => {
    downloads++;
  };
  handlers["messages.markRead"] = () => {
    receipts++;
    return { ok: true };
  };
  handlers["messages.cleanupIfAllRead"] = () => {
    cleanups++;
    return { ok: true };
  };
  for (const [mimeType, kind] of [
    ["image/jpeg", "photo"],
    ["video/mp4", "video"],
  ] as const) {
    descriptors[messageId] = { ...descriptor, mimeType };
    expect(await readWhispMediaKind(message)).toBe(kind);
    expect(descriptors[messageId]).toBeDefined();
  }
  expect(downloads).toBe(0);
  expect(receipts).toBe(0);
  expect(cleanups).toBe(0);
  expect([...files.values()]).not.toContain("plaintext");
  // Metadata sync must leave the descriptor available to the actual viewer.
  const opened = await openWhisp(message);
  expect(opened.mimeType).toBe("video/mp4");
  expect(disposedDownloads).toBe(1);
  await opened.dispose();
  expect(receipts).toBe(0);
});

test("a failed encrypted download releases native progress subscriptions", async () => {
  await selfConversation();
  await seedDescriptor();
  download = async () => {
    throw new Error("Download interrupted");
  };
  await expect(openWhisp(message)).rejects.toThrow("Download interrupted");
  expect(disposedDownloads).toBe(1);
  expect([...files.values()]).not.toContain("plaintext");
});

test("inbox metadata rejects missing and mismatched encrypted descriptors", async () => {
  await selfConversation();
  await expect(readWhispMediaKind(message)).rejects.toThrow(
    "no valid media key",
  );
  for (const changed of [
    { senderId: "mallory" },
    { groupId: "other-group" },
    { messageId: crypto.randomUUID() },
  ]) {
    descriptors[messageId] = { ...descriptor, ...changed };
    await expect(readWhispMediaKind(message)).rejects.toThrow("does not match");
  }
  handlers["mls.delivery"] = () => ({ kind: "legacy" });
  await expect(readWhispMediaKind(message)).rejects.toThrow(
    "missing its delivery keys",
  );
});

test("opening authenticated cached metadata only requests delivery authorization", async () => {
  await selfConversation();
  await seedDescriptor();
  expect(await readWhispMediaKind(message)).toBe("video");
  expect(nativeSyncs).toBe(1);
  // Native storage retains authenticated descriptors after syncing metadata.
  cachedDescriptors = { ...descriptors };
  sessionReads = 0;
  apiCalls = [];
  const opened = await openWhisp(message);
  expect(opened.mimeType).toBe("video/mp4");
  expect(apiCalls).toEqual(["mls.delivery"]);
  expect(sessionReads).toBe(1);
  expect(nativeSyncs).toBe(1);
  await opened.dispose();
});

test("concurrent metadata reads share device loading but authorize every delivery", async () => {
  await selfConversation();
  const messages = Array.from({ length: 3 }, () => {
    const id = crypto.randomUUID();
    descriptors[id] = { ...descriptor, messageId: id };
    return { ...message, messageId: id, deliveryId: crypto.randomUUID() };
  });
  handlers["mls.delivery"] = (input) => {
    const { deliveryId } = z.object({ deliveryId: z.string() }).parse(input);
    const current = messages.find((item) => item.deliveryId === deliveryId);
    if (!current) throw new Error("Missing test delivery");
    return {
      kind: "mls",
      messageId: current.messageId,
      conversationId,
      groupId: null,
    };
  };
  sessionReads = 0;
  apiCalls = [];
  expect(
    await Promise.all(messages.map((item) => readWhispMediaKind(item))),
  ).toEqual(["video", "video", "video"]);
  expect(sessionReads).toBe(1);
  expect(apiCalls).toEqual(["mls.delivery", "mls.delivery", "mls.delivery"]);
});

test("cached metadata never bypasses fresh delivery authorization", async () => {
  await selfConversation();
  cachedDescriptors[messageId] = descriptor;
  handlers["mls.delivery"] = () => {
    throw new Error("This whisp has already been viewed on your account.");
  };
  let downloads = 0;
  download = async () => {
    downloads++;
  };
  await expect(openWhisp(message)).rejects.toThrow("already been viewed");
  expect(downloads).toBe(0);
  expect(nativeSyncs).toBe(0);
});

test("delivery authorization binds the exact message before cached descriptor reuse", async () => {
  await selfConversation();
  cachedDescriptors[messageId] = descriptor;
  let downloads = 0;
  download = async () => {
    downloads++;
  };
  for (const authorizedMessageId of [crypto.randomUUID(), undefined]) {
    handlers["mls.delivery"] = () => ({
      kind: "mls",
      messageId: authorizedMessageId,
      conversationId,
      groupId: null,
    });
    await expect(openWhisp(message)).rejects.toThrow(
      "does not match this delivery",
    );
  }
  expect(downloads).toBe(0);
  expect(nativeSyncs).toBe(0);
});

test("cached descriptors retain sender, message, and group validation", async () => {
  await selfConversation();
  for (const changed of [
    { senderId: "mallory" },
    { messageId: crypto.randomUUID() },
    { groupId: "another-group" },
  ]) {
    cachedDescriptors[messageId] = { ...descriptor, ...changed };
    await expect(readWhispMediaKind(message)).rejects.toThrow("does not match");
  }
  expect(nativeSyncs).toBe(0);
});

test("pending delivery authorization does not block private-state operations", async () => {
  await selfConversation();
  await seedDescriptor();
  const entered = gate();
  const blocked = gate();
  handlers["mls.delivery"] = async () => {
    entered.release();
    await blocked.promise;
    return { kind: "mls", messageId, conversationId, groupId: null };
  };
  const reading = readWhispMediaKind(message);
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
    await reading;
  }
});

test("pending read receipts do not block private-state operations", async () => {
  await selfConversation();
  await seedDescriptor();
  const opened = await openWhisp(message);
  const entered = gate();
  const blocked = gate();
  handlers["messages.markRead"] = async () => {
    entered.release();
    await blocked.promise;
    return { ok: true };
  };
  const receipt = opened.acknowledge();
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
    await receipt;
    await opened.dispose();
  }
});

test("canceled inbox metadata does not provision or query a device", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(readWhispMediaKind(message, controller.signal)).rejects.toThrow(
    "canceled",
  );
  expect(files.size).toBe(0);
});

test("switching accounts during metadata sync discards the decrypted type", async () => {
  await selfConversation();
  await seedDescriptor();
  const entered = gate();
  const blocked = gate();
  syncDescriptors = async () => {
    entered.release();
    await blocked.promise;
    return JSON.stringify(descriptors);
  };
  const reading = readWhispMediaKind(message);
  await entered.promise;
  userId = "bob";
  blocked.release();
  await expect(reading).rejects.toThrow("account or encryption device changed");
});

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

test("opening does not wait for key maintenance after offline provisioning failed", async () => {
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
  apiCalls = [];
  const opened = await openWhisp(message);
  expect(published).toBe(0);
  expect(apiCalls).toEqual(["mls.delivery"]);
  await opened.dispose();
  // App lifecycle retries maintenance independently, preserving publish ordering.
  await prepareEncryptionDevice();
  expect(published).toBe(32);
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

test("changing accounts during native acknowledgement stops remaining job side effects", async () => {
  const client = new QueryClient();
  const first = queuedSend("sent", null);
  const second = queuedSend("failed", "Failure for previous account");
  const pending = queuedSend("uploading", null);
  nativeJobs = [first, second, pending];
  onAcknowledge = () => {
    userId = "bob";
  };
  await reconcileNativeSends(client);
  expect(acknowledgedJobs).toEqual([first.id]);
  expect(notices.error).toEqual([]);
  expect(getOutboxStatusSnapshot()[pending.recipients[0]]).toBeUndefined();
  client.clear();
});
