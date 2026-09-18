import { nativeSend, newId } from "react-native-whisp-mls";

import { z } from "zod/v4";

import { authClient } from "./auth";
import { withEncryptionDevice } from "./mls-device";
import { nativeDeviceConfig } from "./mls-native-config";

const jobSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["photo", "video"]),
  recipients: z.array(z.string()),
  groupId: z.string().nullable(),
  status: z.enum(["uploading", "sent", "failed"]),
  error: z.string().nullable(),
  createdAt: z.number(),
});
export type SendJob = z.infer<typeof jobSchema>;

export async function configureNativeSends() {
  const cookie = authClient.getCookie();
  const session = await authClient.getSession();
  if (cookie !== authClient.getCookie())
    throw new Error(
      "The account changed. Retry sending on the original account.",
    );
  if (!cookie || !session.data?.user.id) {
    await nativeSend.configure(null);
    return;
  }
  return withEncryptionDevice(async (device) => {
    if (cookie !== authClient.getCookie())
      throw new Error(
        "The account changed. Retry sending on the original account.",
      );
    await nativeSend.configure(nativeDeviceConfig(device));
    return device.deviceId;
  });
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
  const deviceId = await configureNativeSends();
  if (!cookie || cookie !== authClient.getCookie())
    throw new Error(
      "The account changed. Retry sending on the original account.",
    );
  return nativeSend.enqueue(
    JSON.stringify({
      id: newId(),
      deviceId,
      source: decodeURIComponent(input.uri.slice(7)),
      kind: input.type,
      recipients: input.recipients,
      groupId: input.groupId ?? null,
    }),
  );
}
export async function listNativeSends() {
  return z.array(jobSchema).parse(JSON.parse(await nativeSend.list()));
}
export const resumeNativeSends = () => nativeSend.resume();

export const acknowledgeNativeSend = (id: string) => nativeSend.acknowledge(id);
