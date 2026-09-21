import { decryptAttachment, MlsError, newId } from "react-native-whisp-mls";

import { isTRPCClientError } from "@trpc/client";
import * as FS from "expo-file-system/legacy";

import type { AppRouter } from "@acme/api";

import { getBaseUrl } from "./base-url";
import { mimeToMediaKind } from "./media-kind";
import {
  forgetDescriptor,
  readConversationDescriptor,
} from "./mls-conversation";
import {
  assertEncryptionDeviceCurrent,
  getEncryptionDevice,
  registerDevice,
  withEncryptionDevice,
} from "./mls-device";
import { acquireWhispCiphertext } from "./whisp-ciphertext";

const ENCRYPTED_MIME = "application/vnd.whisp.mls.v1";

function retryableStatus(status: number | undefined) {
  return (
    status === 408 || status === 429 || (status !== undefined && status >= 500)
  );
}

/** Keep transient metadata failures recoverable while the inbox is observed. */
export function retryWhispMediaKind(failureCount: number, error: Error) {
  if (MlsError.instanceOf(error)) {
    if (MlsError.Transport.instanceOf(error)) return true;
    if (MlsError.Request.instanceOf(error))
      return retryableStatus(error.inner.status) || failureCount < 1;
  }
  if (isTRPCClientError<AppRouter>(error)) {
    const response = error.meta?.response;
    if (
      error.cause instanceof TypeError ||
      retryableStatus(error.data?.httpStatus) ||
      (response instanceof Response && retryableStatus(response.status))
    )
      return true;
  }
  return failureCount < 1;
}

function localPath(uri: string) {
  if (!uri.startsWith("file://"))
    throw new Error(
      "The media file is not available locally. Select or capture it again.",
    );
  return decodeURIComponent(uri.slice(7));
}

export type OpenedWhisp = {
  uri: string;
  mimeType: string;
  thumbhash?: string;
  dispose: () => Promise<void>;
  acknowledge: () => Promise<void>;
};
type WhispMessage = {
  deliveryId: string;
  messageId: string;
  senderId: string;
  groupId?: string;
  fileUrl: string;
  mimeType?: string;
  thumbhash?: string;
};

async function prepareWhisp(message: WhispMessage, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Inbox metadata sync canceled.");
  const device = await getEncryptionDevice();
  if (signal?.aborted) throw new Error("Inbox metadata sync canceled.");
  await registerDevice(device);
  if (signal?.aborted) throw new Error("Inbox metadata sync canceled.");
  // Authorization is required even when the authenticated descriptor is already
  // local. Network latency must not hold the device-wide private-state lease.
  const delivery = await device.api.mls.delivery.query(
    {
      deviceId: device.deviceId,
      deliveryId: message.deliveryId,
    },
    { signal },
  );
  if (delivery.kind === "legacy") {
    if (message.mimeType === ENCRYPTED_MIME)
      throw new Error(
        "This encrypted whisp is missing its delivery keys. It has not been marked read.",
      );
    await assertEncryptionDeviceCurrent(device);
    return { kind: "legacy" as const, device };
  }
  if (delivery.messageId !== message.messageId)
    throw new Error(
      "The encrypted whisp does not match this delivery. It remains unread.",
    );
  return withEncryptionDevice(async () => {
    if (signal?.aborted) throw new Error("Inbox metadata sync canceled.");
    const descriptor = await readConversationDescriptor(
      device,
      delivery.conversationId,
      message.messageId,
    );
    if (!descriptor)
      throw new Error(
        "This whisp has no valid media key on this device. Open it on an original recipient device, or ask the sender to resend it. It remains unread.",
      );
    if (
      descriptor.messageId !== message.messageId ||
      descriptor.senderId !== message.senderId ||
      descriptor.groupId !== delivery.groupId ||
      descriptor.groupId !== (message.groupId ?? null)
    )
      throw new Error(
        "The encrypted whisp does not match this delivery. It remains unread.",
      );
    return {
      kind: "mls" as const,
      device,
      descriptor,
      conversationId: delivery.conversationId,
    };
  }, device);
}

/** Read only authenticated metadata. Never download media or acknowledge a view. */
export async function readWhispMediaKind(
  message: WhispMessage,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new Error("Inbox metadata sync canceled.");
  if (message.mimeType !== ENCRYPTED_MIME)
    return mimeToMediaKind(message.mimeType);
  const prepared = await prepareWhisp(message, signal);
  await assertEncryptionDeviceCurrent(prepared.device);
  if (signal?.aborted) throw new Error("Inbox metadata sync canceled.");
  return mimeToMediaKind(
    prepared.kind === "mls" ? prepared.descriptor.mimeType : message.mimeType,
  );
}

export async function openWhisp(message: WhispMessage): Promise<OpenedWhisp> {
  const prepared = await prepareWhisp(message);
  const { device } = prepared;
  const api = device.api;
  let uri = message.fileUrl;
  let mimeType = message.mimeType ?? "image/jpeg";
  let thumbhash = message.thumbhash;
  if (prepared.kind === "mls") {
    const { descriptor } = prepared;
    const directory = `${FS.cacheDirectory}whisp-decrypted/`;
    await FS.makeDirectoryAsync(directory, { intermediates: true });
    const name = newId();
    const plaintext = `${directory}${name}.${descriptor.mimeType === "video/mp4" ? "mp4" : "jpg"}`;
    const encrypted = await acquireWhispCiphertext(
      message,
      JSON.stringify([getBaseUrl(), device.userId]),
    );
    try {
      try {
        await decryptAttachment(
          localPath(encrypted.uri),
          localPath(plaintext),
          descriptor.key,
        );
      } finally {
        await encrypted.release();
      }
      uri = plaintext;
      mimeType = descriptor.mimeType;
      thumbhash = descriptor.thumbhash;
    } catch (error) {
      await FS.deleteAsync(plaintext, { idempotent: true });
      throw error;
    }
  }
  // Media work runs without the ratchet lock. Do not display its result after
  // an account switch or local identity reset during the download.
  try {
    await assertEncryptionDeviceCurrent(device);
  } catch (error) {
    if (prepared.kind === "mls")
      await FS.deleteAsync(uri, { idempotent: true });
    throw error;
  }
  let receipt: Promise<void> | undefined;
  let disposal: Promise<void> | undefined;
  return {
    uri,
    mimeType,
    thumbhash,
    dispose: () => {
      disposal ??= (async () => {
        if (prepared.kind === "mls")
          await FS.deleteAsync(uri, { idempotent: true });
        if (receipt) {
          await receipt;
          await api.messages.cleanupIfAllRead.mutate({
            messageId: message.messageId,
          });
        }
      })();
      return disposal;
    },
    acknowledge: () => {
      if (disposal)
        return Promise.reject(new Error("This whisp is already closed."));
      receipt ??= (async () => {
        await assertEncryptionDeviceCurrent(device);
        await api.messages.markRead.mutate({ deliveryId: message.deliveryId });
        if (prepared.kind === "mls") {
          await withEncryptionDevice(
            (currentDevice) =>
              forgetDescriptor(
                currentDevice,
                prepared.conversationId,
                message.messageId,
              ),
            device,
          );
        }
      })();
      return receipt;
    },
  };
}
