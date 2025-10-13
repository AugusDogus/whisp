import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { checkNotifications } from "react-native-permissions";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

import { navigationRef } from "~/navigation/RootNavigator";
import { trpc } from "~/utils/api";
import { EXPO_PROJECT_ID } from "~/utils/constants";

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
});

export function usePushNotifications(isAuthenticated: boolean) {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] =
    useState<Notifications.Notification | null>(null);
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const notificationListener = useRef<
    Notifications.EventSubscription | undefined
  >(undefined);
  const responseListener = useRef<Notifications.EventSubscription | undefined>(
    undefined,
  );

  const registerToken = trpc.notifications.registerPushToken.useMutation();

  // Clear all notifications when app comes to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active") {
        // App has come to the foreground, clear all notifications
        void Notifications.dismissAllNotificationsAsync();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // Check permissions (don't request automatically - onboarding handles that)
  useEffect(() => {
    let mounted = true;

    checkNotifications()
      .then(({ status }) => {
        if (mounted) {
          setPermissionsGranted(status === "granted");
        }
      })
      .catch((error) => {
        console.error("Failed to check notification permissions:", error);
        if (mounted) {
          setPermissionsGranted(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Set up notification listeners
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    // Listen for notifications received while app is foregrounded
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        setNotification(notification);
      });

    // Listen for notification taps
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        console.log("Notification tapped:", response);
        const data = response.notification.request.content.data;

        // Handle navigation based on notification type

        if (data.type === "message") {
          // Navigate to Friends screen with the sender ID to auto-open messages
          if (navigationRef.current && data.senderId) {
            navigationRef.current.navigate("Main", {
              screen: "Friends",
              params: { openMessageFromSender: data.senderId },
            });
          }
        } else if (data.type === "friend_request") {
          // Navigate to Friends screen
          if (navigationRef.current) {
            navigationRef.current.navigate("Main", {
              screen: "Friends",
            });
          }
        } else if (data.type === "friend_accept") {
          // Navigate to Friends screen
          if (navigationRef.current) {
            navigationRef.current.navigate("Main", {
              screen: "Friends",
            });
          }
        }
      });

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [isAuthenticated]);

  // Register token only after authentication AND permissions are granted
  useEffect(() => {
    // Don't register push notifications until user is authenticated and permissions granted
    if (!isAuthenticated || !permissionsGranted) {
      return;
    }

    let mounted = true;

    getExpoPushToken()
      .then((token) => {
        if (token && mounted) {
          setExpoPushToken(token);
          // Register token with backend
          registerToken.mutate({
            token,
            platform: Platform.OS === "ios" ? "ios" : "android",
          });
        }
      })
      .catch((error) => {
        console.error("Failed to get push token:", error);
      });

    return () => {
      mounted = false;
    };
    // registerToken is intentionally excluded from deps because it's a stable
    // tRPC mutation function that doesn't need to trigger re-registration.
    // We only want to register the push token when auth or permission state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, permissionsGranted]);

  return {
    expoPushToken,
    notification,
  };
}

// Get Expo push token (called after auth and permissions are granted)
async function getExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }

  try {
    if (!EXPO_PROJECT_ID) {
      throw new Error("EXPO_PUBLIC_PROJECT_ID not found in environment");
    }

    const pushToken = await Notifications.getExpoPushTokenAsync({
      projectId: EXPO_PROJECT_ID,
    });
    const tokenData: string = pushToken.data;
    return tokenData;
  } catch (error) {
    console.error("Error getting push token:", error);

    // Check if it's a Firebase configuration error
    if (error instanceof Error && error.message.includes("FirebaseApp")) {
      console.warn(
        "Push notifications require Firebase configuration for Android. " +
          "See: https://docs.expo.dev/push-notifications/fcm-credentials/",
      );
    }

    return null;
  }
}
