import type { SendJob } from "../../utils/native-send";

import { createTRPCClient, TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { afterAll, beforeEach, mock } from "bun:test";
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

const notices: {
  error: string[];
  info: string[];
  success: string[];
} = {
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

interface BoundaryState {
  userId: string;
  signedOut: boolean;
  sessionMissing: boolean;
  sessionError: {
    message: string;
  } | null;
  sessionReads: number;
  nativeSyncs: number;
  cachedDescriptors: Record<string, unknown>;
  apiCalls: string[];
  nativeConfigurations: (string | null)[];
  nativeJobs: SendJob[];
  acknowledgedJobs: string[];
  onAcknowledge: () => void;
  descriptors: Record<string, unknown>;
  syncDescriptors: () => Promise<string>;
  nativeEnqueue: (input: string) => Promise<string>;
  nativeConfigure: () => Promise<void>;
  download: () => Promise<void>;
  disposedDownloads: number;
  handlers: Record<string, (input: unknown) => unknown>;
}
export const state: BoundaryState = {
  userId: "alice",
  signedOut: false,
  sessionMissing: false,
  sessionError: null,
  sessionReads: 0,
  nativeSyncs: 0,
  cachedDescriptors: {},
  apiCalls: [],
  nativeConfigurations: [],
  nativeJobs: [],
  acknowledgedJobs: [],
  onAcknowledge: () => {},
  descriptors: {},
  syncDescriptors: async () => JSON.stringify(state.descriptors),
  nativeEnqueue: async () => messageId,
  nativeConfigure: async () => {},
  download: async () => {},
  disposedDownloads: 0,
  handlers: {},
};

class NativeTransportError extends Error {
  static instanceOf(error: unknown): error is NativeTransportError {
    return error instanceof NativeTransportError;
  }
}
class NativeRequestError extends Error {
  constructor(
    readonly inner: {
      status: number;
    },
  ) {
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
              state.apiCalls.push(op.path);
              const handler = state.handlers[op.path];
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
const originalApi = { ...(await import("../../utils/api")) };
const originalAuth = { ...(await import("../../utils/auth")) };
const originalBaseUrl = { ...(await import("../../utils/base-url")) };
mock.module("../../utils/api", () => ({
  ...originalApi,
  createExpoTRPCClient: () => api,
}));
mock.module("../../utils/auth", () => ({
  authClient: {
    ...originalAuth.authClient,
    getCookie: () => (state.signedOut ? null : `session-${state.userId}`),
    getSession: async () => {
      state.sessionReads++;
      return {
        data:
          state.signedOut || state.sessionMissing || state.sessionError
            ? null
            : { user: { id: state.userId } },
        error: state.sessionError,
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
    await state.download();
    files.set(path, "ciphertext");
    return { status: 200 };
  },
  createDownloadResumable: (_url: string, path: string) => ({
    cancelAsync: async () => {
      state.disposedDownloads++;
    },
    downloadAsync: async () => {
      await state.download();
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
    const cached = state.cachedDescriptors[id];
    return cached === undefined ? undefined : JSON.stringify(cached);
  },
  syncNativeConversation: () => {
    state.nativeSyncs++;
    return state.syncDescriptors();
  },
  forgetNativeDescriptor: async (
    _config: string,
    _conversation: string,
    id: string,
  ) => {
    delete state.descriptors[id];
    delete state.cachedDescriptors[id];
  },
  MlsClient: NativeClient,
  acquireDeviceLease: async () => ({ release: () => {} }),
  nativeSend: {
    list: async () => JSON.stringify(state.nativeJobs),
    acknowledge: async (id: string) => {
      state.acknowledgedJobs.push(id);
      state.onAcknowledge();
    },
    configure: async (config: string | null) => {
      state.nativeConfigurations.push(config);
      await state.nativeConfigure();
    },
    enqueue: (input: string) => state.nativeEnqueue(input),
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
mock.module("../../utils/base-url", () => ({
  getBaseUrl: () => "https://whisp.test",
}));
const {
  withEncryptionDevice,
  prepareEncryptionDevice,
  registerDevice,
  resetEncryptionDevice,
} = await import("../../utils/mls-device");
const { openWhisp, readWhispMediaKind, retryWhispMediaKind } =
  await import("../../utils/mls-media");
const { useInboxMediaKinds } = await import("~/hooks/useInboxMediaKinds");
const { enqueueNativeSend, configureNativeSends } =
  await import("../../utils/native-send");
const { reconcileNativeSends, uploadMedia } =
  await import("../../utils/media-upload");
beforeEach(() => {
  files.clear();
  secure.clear();
  state.userId = "alice";
  state.signedOut = false;
  state.sessionMissing = false;
  state.sessionError = null;
  state.sessionReads = 0;
  state.nativeSyncs = 0;
  state.cachedDescriptors = {};
  state.apiCalls = [];
  state.nativeConfigurations = [];
  state.nativeJobs = [];
  state.acknowledgedJobs = [];
  state.onAcknowledge = () => {};
  notices.error.length = notices.info.length = notices.success.length = 0;
  state.descriptors = {};
  state.syncDescriptors = async () => JSON.stringify(state.descriptors);
  state.nativeEnqueue = async () => messageId;
  state.nativeConfigure = async () => {};
  state.download = async () => {};
  state.disposedDownloads = 0;
  state.handlers = {
    "mls.register": () => ({ ok: true }),
    "mls.inventory": () =>
      Array.from({ length: 32 }, () => crypto.randomUUID()),
    "mls.retainedKeys": () => [],
    "mls.retainedMessages": () => [messageId],
  };
});
afterAll(() => {
  mock.restore();
  mock.module("../../utils/api", () => originalApi);
  mock.module("../../utils/auth", () => originalAuth);
  mock.module("../../utils/base-url", () => originalBaseUrl);
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
  state.handlers["mls.prepare"] = () => ({
    draftId: messageId,
    conversations: [{ id: conversationId }],
  });
  state.handlers["mls.sync"] = () => ({
    conversation: { revision },
    welcome: null,
    events: [],
  });
  state.handlers["mls.begin"] = () => ({
    operationId: crypto.randomUUID(),
    members: [{ deviceId: device.deviceId, userId: "alice", signatureKey }],
    packages: [],
  });
  state.handlers["mls.append"] = () => {
    revision += 2;
    return { revision };
  };
  state.handlers["mls.settle"] = () => ({ revision });
  state.handlers["mls.delivery"] = () => ({
    kind: "mls",
    messageId,
    conversationId,
    groupId: null,
  });
  state.handlers["messages.markRead"] = () => ({ ok: true });
  state.handlers["messages.cleanupIfAllRead"] = () => ({ ok: true });
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
  state.descriptors[messageId] = descriptor;
}

export {
  files,
  secure,
  encode,
  signatureKey,
  conversationId,
  messageId,
  notices,
  NativeTransportError,
  NativeRequestError,
  withEncryptionDevice,
  prepareEncryptionDevice,
  registerDevice,
  resetEncryptionDevice,
  openWhisp,
  readWhispMediaKind,
  retryWhispMediaKind,
  useInboxMediaKinds,
  enqueueNativeSend,
  configureNativeSends,
  reconcileNativeSends,
  uploadMedia,
  descriptor,
  message,
  selfConversation,
  gate,
  seedDescriptor,
};
