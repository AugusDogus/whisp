import type { EncryptionDevice } from "./mls-device";

import { version as uploadthingVersion } from "uploadthing/client";

import { getBaseUrl } from "./base-url";

export function nativeDeviceConfig(device: EncryptionDevice) {
  return JSON.stringify({
    root: decodeURIComponent(device.root.slice(7)),
    userId: device.userId,
    deviceId: device.deviceId,
    storageKey: device.storageKey,
    cookie: device.cookie,
    baseUrl: getBaseUrl(),
    uploadthingVersion,
    allowInsecureHttp: typeof __DEV__ !== "undefined" && __DEV__,
  });
}
