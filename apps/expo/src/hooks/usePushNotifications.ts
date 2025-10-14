import { useCallback, useEffect, useRef, useState } from "react";
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
      shouldShowAlert: false, // Don't show banner when app is in foreground
      shouldPlaySound: false, // Don't play sound when app is in foreground
      shouldSetBadge: false, // Don't update badge when app is in foreground
      shouldShowBanner: false, // Don't show banner when app is in foreground
      shouldShowList: false, // Don't add to notification list when app is in foreground
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
  const utils = trpc.useUtils();

  // Handle notification response (common logic for both tap scenarios)
  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data;
      console.log("Notification data:", data);

      // Invalidate relevant queries before navigation to ensure fresh data
      if (data.type === "message") {
        console.log("Invalidating inbox query before navigation");
        void utils.messages.inbox.invalidate();
      } else if (
        data.type === "friend_request" ||
        data.type === "friend_accept"
      ) {
        console.log("Invalidating friends queries before navigation");
        void utils.friends.list.invalidate();
        void utils.friends.incomingRequests.invalidate();
      }

      // Handle navigation based on notification type
      if (data.type === "message") {
        // Navigate to Friends screen with the sender ID to auto-open messages
        console.log("Navigating to message from sender:", data.senderId);

        // Validate that senderId is a string
        const senderId = typeof data.senderId === "string" ? data.senderId : "";
        if (navigationRef.current && senderId) {
          // If we have fileUrl and mimeType in the notification, pass them for instant viewing
          const params: {
            openMessageFromSender: string;
            instantMessage?: {
              messageId: string;
              senderId: string;
              fileUrl: string;
              mimeType: string;
              deliveryId: string;
            };
          } = { openMessageFromSender: senderId };

          if (
            data.fileUrl &&
            data.mimeType &&
            data.messageId &&
            data.deliveryId
          ) {
            console.log("Using instant message data from notification");
            params.instantMessage = {
              messageId: data.messageId as string,
              senderId: data.senderId as string,
              fileUrl: data.fileUrl as string,
              mimeType: data.mimeType as string,
              deliveryId: data.deliveryId as string,
            };
          }

          navigationRef.current.navigate("Main", {
            screen: "Friends",
            params,
          });
        } else {
          console.warn("Navigation ref or senderId not available");
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
    },
    [utils],
  );

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

    // Check if app was opened by tapping a notification (when launched from killed state)
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) {
          console.log("App opened from notification (killed state):", response);
          handleNotificationResponse(response);
        }
      })
      .catch((error) => {
        console.error("Error getting last notification response:", error);
      });

    // Listen for notifications received while app is foregrounded
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        console.log("Notification received:", notification);
        setNotification(notification);

        // Invalidate queries based on notification type to prefetch fresh data
        const data = notification.request.content.data;
        if (data.type === "message") {
          console.log("Invalidating inbox query for new message notification");
          // This will cause the inbox to refetch in the background
          void utils.messages.inbox.invalidate();
        } else if (
          data.type === "friend_request" ||
          data.type === "friend_accept"
        ) {
          console.log(
            "Invalidating friends queries for friend activity notification",
          );
          void utils.friends.list.invalidate();
          void utils.friends.incomingRequests.invalidate();
        }
      });

    // Listen for notification taps (when app is already running)
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        console.log("Notification tapped (app running):", response);
        handleNotificationResponse(response);
      });

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [
    isAuthenticated,
    handleNotificationResponse,
    utils.messages.inbox,
    utils.friends.list,
    utils.friends.incomingRequests,
  ]);

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
