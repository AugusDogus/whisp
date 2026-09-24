import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { addNetworkStateListener } from "expo-network";
import * as Notifications from "expo-notifications";

import { registerPushToken } from "~/utils/push-notifications";

export function usePushTokenRegistration(sessionId: string | null) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    setToken(null);
    if (!sessionId) return;
    let mounted = true;
    let revision = 0;
    function sync(deviceToken?: Notifications.DevicePushToken) {
      const attempt = ++revision;
      const isCurrent = () => mounted && attempt === revision;
      void registerPushToken(isCurrent, deviceToken)
        .then((registered) => {
          if (isCurrent()) setToken(registered);
        })
        .catch((error) => {
          console.error(
            "Could not register push notifications. Will retry on foreground or network recovery:",
            error,
          );
        });
    }

    sync();
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    const network = addNetworkStateListener((state) => {
      if (state.isInternetReachable) sync();
    });
    const rotation = Notifications.addPushTokenListener(sync);
    return () => {
      mounted = false;
      foreground.remove();
      network.remove();
      rotation.remove();
    };
  }, [sessionId]);

  return token;
}
