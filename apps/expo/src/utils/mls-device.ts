import {
  MlsClient,
  acquireDeviceLease,
  decodeBase64,
  encodeBase64,
  generateStorageKey,
  initializeMls,
  newId,
  utf8Encode,
  writePrivateFile,
} from "react-native-whisp-mls";

import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";

import * as FS from "expo-file-system/legacy";
import { z } from "zod/v4";

import { createExpoTRPCClient } from "./api";
import { authClient } from "./auth";

export class EncryptionSignInRequiredError extends Error {
  constructor() {
    super("Sign in before opening or sending encrypted whisps.");
  }
}

export class EncryptionDeviceChangedError extends Error {
  constructor() {
    super(
      "The account or encryption device changed. Retry this operation on the original account.",
    );
  }
}

const manifestSchema = z.object({ deviceId: z.uuid() });
export type EncryptionDevice = {
  cookie: string;
  userId: string;
  deviceId: string;
  root: string;
  storageKey: string;
  identity: string;
  api: ReturnType<typeof createExpoTRPCClient>;
};
let queue: Promise<unknown> = Promise.resolve();
const cleaned = new Set<string>();
let maintenance:
  | { cookie: string | null | undefined; promise: Promise<void> }
  | undefined;
let registrations:
  | { cookie: string; devices: Map<string, Promise<void>> }
  | undefined;
let deviceLoad:
  | { cookie: string | null | undefined; promise: Promise<EncryptionDevice> }
  | undefined;

/** Share only an in-flight load across inbox rows; never cache a settled identity. */
export function getEncryptionDevice() {
  const cookie = authClient.getCookie();
  if (deviceLoad?.cookie === cookie) return deviceLoad.promise;
  const promise = withEncryptionDevice(async (device) => device).finally(() => {
    if (deviceLoad?.promise === promise) deviceLoad = undefined;
  });
  deviceLoad = { cookie, promise };
  return promise;
}

/** Serialize private-state changes, including concurrent provisioning and receives. */
export function withEncryptionDevice<T>(
  operation: (device: EncryptionDevice) => Promise<T>,
  expected?: EncryptionDevice,
): Promise<T> {
  const cookie = authClient.getCookie();
  const result = queue.then(async () => {
    if (cookie !== authClient.getCookie()) throw deviceChanged();
    if (!expected)
      return loadDevice(async (device) => {
        if (cookie !== authClient.getCookie()) throw deviceChanged();
        return operation(device);
      });
    // A known device needs its current identity checked, not another session
    // request, SecureStore read, directory setup, and client configuration.
    const lease = await acquireDeviceLease(
      decodeURIComponent(expected.root.slice(7)),
    );
    try {
      await assertEncryptionDeviceCurrent(expected);
      return await operation(expected);
    } finally {
      lease.release();
    }
  });
  queue = result.catch(() => undefined);
  return result;
}

function deviceChanged() {
  return new EncryptionDeviceChangedError();
}

/** Check results after non-mutating media work without waiting for the ratchet. */
export async function assertEncryptionDeviceCurrent(
  device: Pick<EncryptionDevice, "cookie" | "root" | "deviceId">,
) {
  if ((authClient.getCookie() ?? "") !== device.cookie) throw deviceChanged();
  const manifest = `${device.root}device.json`;
  if (!(await FS.getInfoAsync(manifest)).exists) throw deviceChanged();
  const saved = manifestSchema.parse(
    JSON.parse(await FS.readAsStringAsync(manifest)),
  );
  if (
    saved.deviceId !== device.deviceId ||
    (authClient.getCookie() ?? "") !== device.cookie
  )
    throw deviceChanged();
}

export async function writeAtomic(path: string, data: string) {
  if (!path.startsWith("file://"))
    throw new Error("Encryption state requires private local storage.");
  writePrivateFile(decodeURIComponent(path.slice(7)), data);
}

export async function restoreClient(
  device: EncryptionDevice,
  path = device.identity,
) {
  const data = await FS.readAsStringAsync(path);
  const client = MlsClient.restoreState(decodeBase64(data), device.storageKey);
  if (!(client instanceof MlsClient))
    throw new Error(
      "The native encryption bindings returned an invalid client. Rebuild the app.",
    );
  return client;
}

function accountStorage(userId: string) {
  if (!FS.documentDirectory)
    throw new Error("Private device storage is unavailable.");
  const account = encodeBase64(utf8Encode(userId))
    .replaceAll("/", "_")
    .replaceAll("+", "-")
    .replaceAll("=", "");
  return {
    root: `${FS.documentDirectory}mls-v1/${account}/`,
    keyName: `whisp.mls.v1.${account}`,
  };
}

/** Destructive local recovery, called only after the encryption recovery confirmation. */
export function resetEncryptionDevice() {
  const result = queue.then(async () => {
    initializeMls();
    const cookie = authClient.getCookie();
    const session = await authClient.getSession();
    const userId = session.data?.user.id;
    if (!userId || cookie !== authClient.getCookie())
      throw new Error("Sign in again before resetting encryption.");
    const { root, keyName } = accountStorage(userId);
    await FS.makeDirectoryAsync(root, { intermediates: true });
    const lease = await acquireDeviceLease(decodeURIComponent(root.slice(7)));
    try {
      const manifest = `${root}device.json`;
      if ((await FS.getInfoAsync(manifest)).exists) {
        const saved = manifestSchema.parse(
          JSON.parse(await FS.readAsStringAsync(manifest)),
        );
        await createExpoTRPCClient(cookie ?? "").mls.revoke.mutate({
          deviceId: saved.deviceId,
        });
      }
      await FS.deleteAsync(root, { idempotent: true });
      await SecureStore.deleteItemAsync(keyName);
      maintenance = undefined;
      deviceLoad = undefined;
    } finally {
      lease.release();
    }
  });
  queue = result.catch(() => undefined);
  return result.then(prepareEncryptionDevice);
}

async function loadDevice<T>(
  operation: (device: EncryptionDevice) => Promise<T>,
): Promise<T> {
  initializeMls();
  const cookie = authClient.getCookie();
  const session = await authClient.getSession();
  if (cookie !== authClient.getCookie())
    throw new Error("The signed-in account changed. Retry this operation.");
  if (session.error)
    throw new Error(
      "Your sign-in could not be checked. Queued sends are preserved. Retry when connected.",
    );
  const userId = session.data?.user.id;
  if (!userId) throw new EncryptionSignInRequiredError();
  if (!FS.documentDirectory || !FS.cacheDirectory)
    throw new Error(
      "Private device storage is unavailable. Restart Whisp and retry.",
    );
  const { root, keyName } = accountStorage(userId);
  await FS.makeDirectoryAsync(root, { intermediates: true });
  const lease = await acquireDeviceLease(decodeURIComponent(root.slice(7)));
  try {
    await FS.makeDirectoryAsync(`${root}packages/`, { intermediates: true });
    await FS.makeDirectoryAsync(`${root}conversations/`, {
      intermediates: true,
    });
    // Remove plaintext left by a crash before any new viewer starts.
    if (!cleaned.has(root)) {
      await FS.deleteAsync(`${FS.cacheDirectory}whisp-decrypted/`, {
        idempotent: true,
      });
      const uploads = `${FS.documentDirectory}whisp-encrypted/`;
      if ((await FS.getInfoAsync(uploads)).exists) {
        for (const filename of await FS.readDirectoryAsync(uploads)) {
          const info = await FS.getInfoAsync(`${uploads}${filename}`);
          if (
            info.exists &&
            info.modificationTime < Date.now() / 1000 - 48 * 3600
          )
            await FS.deleteAsync(info.uri, { idempotent: true });
        }
      }
      cleaned.add(root);
    }
    const manifestPath = `${root}device.json`;
    let storageKey = await SecureStore.getItemAsync(keyName);
    const existing = await FS.getInfoAsync(manifestPath);
    if (!storageKey && existing.exists)
      throw new Error(
        "This device's encryption key is missing. Open Settings > Security > Encryption recovery to receive new whisps. Existing whisps cannot be recovered here.",
      );
    if (!storageKey) {
      storageKey = generateStorageKey();
      await SecureStore.setItemAsync(keyName, storageKey, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }
    const identity = `${root}identity.age`;
    let deviceId: string;
    if (existing.exists) {
      deviceId = manifestSchema.parse(
        JSON.parse(await FS.readAsStringAsync(manifestPath)),
      ).deviceId;
    } else {
      deviceId = newId();
      const client = new MlsClient(deviceId);
      try {
        await writeAtomic(
          identity,
          encodeBase64(client.exportState(storageKey)),
        );
        await writeAtomic(manifestPath, JSON.stringify({ deviceId }));
      } finally {
        client.uniffiDestroy();
      }
    }
    return await operation({
      cookie: cookie ?? "",
      userId,
      deviceId,
      root,
      storageKey,
      identity,
      api: createExpoTRPCClient(cookie ?? ""),
    });
  } finally {
    lease.release();
  }
}

/** Coalesce cold-start registration; delivery authorization still runs every time. */
export function registerDevice(device: EncryptionDevice) {
  if ((authClient.getCookie() ?? "") !== device.cookie)
    return Promise.reject(deviceChanged());
  if (registrations?.cookie !== device.cookie)
    registrations = { cookie: device.cookie, devices: new Map() };
  const registry = registrations.devices;
  const existing = registry.get(device.deviceId);
  if (existing) return existing;
  const pending = publishDeviceRegistration(device).catch((error) => {
    registry.delete(device.deviceId);
    throw error;
  });
  registry.set(device.deviceId, pending);
  return pending;
}

async function publishDeviceRegistration(device: EncryptionDevice) {
  const api = device.api;
  const client = await restoreClient(device);
  try {
    await api.mls.register.mutate({
      deviceId: device.deviceId,
      signatureKey: encodeBase64(client.signatureKey()),
      name: (
        Device.modelName?.trim() || `${Device.osName ?? "Mobile"} device`
      ).slice(0, 100),
    });
  } finally {
    client.uniffiDestroy();
  }
}

export async function replenishKeys(device: EncryptionDevice) {
  await assertEncryptionDeviceCurrent(device);
  await registerDevice(device);
  const api = device.api;
  const [retainedIds, available] = await Promise.all([
    api.mls.retainedKeys.query({ deviceId: device.deviceId }),
    api.mls.inventory.query({ deviceId: device.deviceId }),
  ]);
  const packages = await withEncryptionDevice(async () => {
    const retained = new Set(retainedIds);
    // Available keys are retained even when claimed during these requests. The
    // grace period also protects unpublished files from interrupted maintenance.
    for (const filename of await FS.readDirectoryAsync(
      `${device.root}packages/`,
    )) {
      const info = await FS.getInfoAsync(`${device.root}packages/${filename}`);
      if (
        info.exists &&
        !retained.has(filename.replace(/\.age$/, "")) &&
        info.modificationTime < Date.now() / 1000 - 3600
      )
        await FS.deleteAsync(info.uri, { idempotent: true });
    }
    const generated: { id: string; data: string }[] = [];
    if (available.length >= 16) return generated;
    for (let i = available.length; i < 32; i++) {
      const participant = await restoreClient(device);
      const id = newId();
      try {
        const data = encodeBase64(participant.keyPackage());
        // Persist the private init key BEFORE publishing the public KeyPackage.
        await writeAtomic(
          `${device.root}packages/${id}.age`,
          encodeBase64(participant.exportState(device.storageKey)),
        );
        generated.push({ id, data });
      } finally {
        participant.uniffiDestroy();
      }
    }
    return generated;
  }, device);
  if (packages.length === 0) return;
  await assertEncryptionDeviceCurrent(device);
  await api.mls.publish.mutate({ deviceId: device.deviceId, packages });
}

export function prepareEncryptionDevice() {
  const cookie = authClient.getCookie();
  if (maintenance?.cookie === cookie) return maintenance.promise;
  const promise = getEncryptionDevice()
    .then(replenishKeys)
    .finally(() => {
      if (maintenance?.promise === promise) maintenance = undefined;
    });
  maintenance = { cookie, promise };
  return promise;
}
