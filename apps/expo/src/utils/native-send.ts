import type { EncryptionDevice } from "./mls-device";

import { nativeSend, newId } from "react-native-whisp-mls";

import { z } from "zod/v4";

import { authClient } from "./auth";
import { getBaseUrl } from "./base-url";
import {
  assertEncryptionDeviceCurrent,
  EncryptionDeviceChangedError,
  EncryptionSignInRequiredError,
  withEncryptionDevice,
} from "./mls-device";
import { nativeDeviceConfig } from "./mls-native-config";

const jobSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["photo", "video"]),
  recipients: z.array(z.string()),
  groupId: z.string().nullable(),
  status: z.enum(["uploading", "blocked", "sent", "failed"]),
  error: z.string().nullable(),
  createdAt: z.number(),
});
export type SendJob = z.infer<typeof jobSchema>;

let configured:
  | (Pick<EncryptionDevice, "cookie" | "root" | "deviceId"> & {
      baseUrl: string;
    })
  | undefined;
let configurationQueue: Promise<unknown> = Promise.resolve();

// Keep native account configuration and enqueue invocation in order. The native
// source copy runs outside this queue so it cannot delay account changes.
function serializeConfiguration<T>(operation: () => Promise<T>): Promise<T> {
  const result = configurationQueue.then(operation);
  configurationQueue = result.catch(() => undefined);
  return result;
}

async function configure(
  cookie: string | null | undefined,
): Promise<string | undefined> {
  if (cookie !== authClient.getCookie())
    throw new EncryptionDeviceChangedError();
  configured = undefined;
  if (!cookie) {
    await nativeSend.configure(null);
    return;
  }
  // Loading the device checks the session and account once under the queue.
  // A failed lookup preserves the existing native worker configuration.
  return withEncryptionDevice(async (device) => {
    if (cookie !== authClient.getCookie())
      throw new Error(
        "The account changed. Retry sending on the original account.",
      );
    await nativeSend.configure(nativeDeviceConfig(device));
    if (cookie !== authClient.getCookie())
      throw new EncryptionDeviceChangedError();
    configured = {
      cookie: device.cookie,
      root: device.root,
      deviceId: device.deviceId,
      baseUrl: getBaseUrl(),
    };
    return device.deviceId;
  }).catch(async (error: unknown) => {
    if (!(error instanceof EncryptionSignInRequiredError)) throw error;
    if (cookie !== authClient.getCookie()) throw error;
    await nativeSend.configure(null);
    return undefined;
  });
}

/** Explicit lifecycle refresh always rechecks authentication, including expiry. */
export function configureNativeSends() {
  const cookie = authClient.getCookie();
  return serializeConfiguration(() => configure(cookie));
}

export async function enqueueNativeSend(input: {
  uri: string;
  type: "photo" | "video";
  recipients: string[];
  groupId?: string;
}) {
  if (!input.uri.startsWith("file://"))
    throw new Error(
      "The captured media is unavailable locally. Capture it again.",
    );
  const cookie = authClient.getCookie();
  const { enqueued } = await serializeConfiguration(async () => {
    if (!cookie || cookie !== authClient.getCookie())
      throw new EncryptionDeviceChangedError();
    let deviceId: string | undefined;
    if (configured?.cookie === cookie && configured.baseUrl === getBaseUrl()) {
      try {
        await assertEncryptionDeviceCurrent(configured);
        deviceId = configured.deviceId;
      } catch (error) {
        if (!(error instanceof EncryptionDeviceChangedError)) throw error;
        configured = undefined;
      }
    }
    deviceId ??= await configure(cookie);
    if (cookie !== authClient.getCookie())
      throw new EncryptionDeviceChangedError();
    if (!deviceId) throw new EncryptionSignInRequiredError();
    return {
      enqueued: nativeSend.enqueue(
        JSON.stringify({
          id: newId(),
          deviceId,
          source: decodeURIComponent(input.uri.slice(7)),
          kind: input.type,
          recipients: input.recipients,
          groupId: input.groupId ?? null,
        }),
      ),
    };
  });
  return enqueued;
}
export async function listNativeSends() {
  return z.array(jobSchema).parse(JSON.parse(await nativeSend.list()));
}
export const resumeNativeSends = () => nativeSend.resume();
export const subscribeNativeSends = (listener: () => void) =>
  nativeSend.subscribe(listener);

export const acknowledgeNativeSend = (id: string) => nativeSend.acknowledge(id);
