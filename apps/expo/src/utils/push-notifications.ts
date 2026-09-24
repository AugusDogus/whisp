import { Platform } from "react-native";
import { checkNotifications } from "react-native-permissions";

import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

import { createExpoTRPCClient } from "./api";
import { EXPO_PROJECT_ID } from "./constants";

const client = createExpoTRPCClient();

// Registration follows the current session. Logout is handled by the server's
// session foreign key and never needs to acquire or remove a native push token.
export async function registerPushToken(
  isCurrent: () => boolean,
  devicePushToken?: Notifications.DevicePushToken,
): Promise<string | null> {
  if (!Device.isDevice) return null;
  const { status } = await checkNotifications();
  if (status !== "granted" || !isCurrent()) return null;
  const token = await Notifications.getExpoPushTokenAsync({
    projectId: EXPO_PROJECT_ID,
    ...(devicePushToken ? { devicePushToken } : {}),
  });
  if (!isCurrent()) return null;
  await client.notifications.registerPushToken.mutate({
    token: token.data,
    platform: Platform.OS === "ios" ? "ios" : "android",
  });
  return token.data;
}
