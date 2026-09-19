import type { EncryptionDevice } from "./mls-device";

import {
  forgetNativeDescriptor,
  syncNativeConversation,
} from "react-native-whisp-mls";

import { z } from "zod/v4";

import { nativeDeviceConfig } from "./mls-native-config";

export const descriptorSchema = z.object({
  version: z.literal(1),
  messageId: z.uuid(),
  senderId: z.string().min(1),
  groupId: z.string().nullable(),
  key: z.string().min(1).max(256),
  mimeType: z.enum(["image/jpeg", "video/mp4"]),
  thumbhash: z.string().max(256).optional(),
});
export type Descriptor = z.infer<typeof descriptorSchema>;
const descriptorsSchema = z.record(z.string(), descriptorSchema).nullable();

/** Caller holds withEncryptionDevice's native lease throughout the operation. */
export async function syncConversation(
  device: EncryptionDevice,
  conversationId: string,
) {
  const descriptors = descriptorsSchema.parse(
    JSON.parse(
      await syncNativeConversation(nativeDeviceConfig(device), conversationId),
    ),
  );
  return descriptors ? { descriptors } : null;
}
export async function forgetDescriptor(
  device: EncryptionDevice,
  conversationId: string,
  messageId: string,
) {
  await forgetNativeDescriptor(
    nativeDeviceConfig(device),
    conversationId,
    messageId,
  );
}
