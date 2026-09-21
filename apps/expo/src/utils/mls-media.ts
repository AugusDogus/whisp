import { decryptAttachment, MlsError, newId } from "react-native-whisp-mls";

import { isTRPCClientError } from "@trpc/client";
import * as FS from "expo-file-system/legacy";

import type { AppRouter } from "@acme/api";

import { mimeToMediaKind } from "./media-kind";
import { forgetDescriptor, syncConversation } from "./mls-conversation";
import { replenishKeys, withEncryptionDevice } from "./mls-device";

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
  return withEncryptionDevice(async (device) => {
    if (signal?.aborted) throw new Error("Inbox metadata sync canceled.");
    const api = device.api;
    await replenishKeys(device);
    const delivery = await api.mls.delivery.query({
      deviceId: device.deviceId,
      deliveryId: message.deliveryId,
    });
    if (delivery.kind === "legacy") {
      if (message.mimeType === ENCRYPTED_MIME)
        throw new Error(
          "This encrypted whisp is missing its delivery keys. It has not been marked read.",
        );
      return { kind: "legacy" as const, device };
    }
    const conversation = await syncConversation(
      device,
      delivery.conversationId,
    );
    const descriptor = conversation?.descriptors[message.messageId];
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
  });
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
  return withEncryptionDevice(async () => {
    if (signal?.aborted) throw new Error("Inbox metadata sync canceled.");
    return mimeToMediaKind(
      prepared.kind === "mls" ? prepared.descriptor.mimeType : message.mimeType,
    );
  }, prepared.device);
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
    const encrypted = `${directory}${name}.age`;
    const plaintext = `${directory}${name}.${descriptor.mimeType === "video/mp4" ? "mp4" : "jpg"}`;
    try {
      const download = await FS.downloadAsync(message.fileUrl, encrypted);
      if (download.status !== 200)
        throw new Error(
          "The encrypted media could not be downloaded. Retry this whisp.",
        );
      await decryptAttachment(
        localPath(encrypted),
        localPath(plaintext),
        descriptor.key,
      );
      uri = plaintext;
      mimeType = descriptor.mimeType;
      thumbhash = descriptor.thumbhash;
    } catch (error) {
      await FS.deleteAsync(plaintext, { idempotent: true });
      throw error;
    } finally {
      await FS.deleteAsync(encrypted, { idempotent: true });
    }
  }
  // Media work runs without the ratchet lock. Do not display its result after
  // an account switch or local identity reset during the download.
  try {
    await withEncryptionDevice(async () => {}, device);
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
      receipt ??= withEncryptionDevice(async (currentDevice) => {
        await api.messages.markRead.mutate({ deliveryId: message.deliveryId });
        if (prepared.kind === "mls") {
          await forgetDescriptor(
            currentDevice,
            prepared.conversationId,
            message.messageId,
          );
        }
      }, device);
      return receipt;
    },
  };
}
