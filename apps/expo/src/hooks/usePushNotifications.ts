import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import * as Notifications from "expo-notifications";

import { navigationRef } from "~/navigation/RootNavigator";
import { trpc } from "~/utils/api";

import { usePushTokenRegistration } from "./usePushTokenRegistration";

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

export function usePushNotifications(sessionId: string | null) {
  const expoPushToken = usePushTokenRegistration(sessionId);
  const [notification, setNotification] =
    useState<Notifications.Notification | null>(null);
  const notificationListener = useRef<
    Notifications.EventSubscription | undefined
  >(undefined);
  const responseListener = useRef<Notifications.EventSubscription | undefined>(
    undefined,
  );

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
        void utils.friends.list.invalidate();
        if (data.groupId) {
          void utils.groups.list.invalidate();
        }
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
        const groupId = typeof data.groupId === "string" ? data.groupId : null;
        if (groupId && navigationRef.current) {
          console.log("Navigating to group from notification:", groupId);
          navigationRef.current.navigate("Group", { groupId });
        } else {
          const senderId =
            typeof data.senderId === "string" ? data.senderId : "";
          console.log("Navigating to message from sender:", senderId);
          if (navigationRef.current && senderId) {
            // Resolve notification content from the server so old pushes cannot bypass a block.
            const params = { openMessageFromSender: senderId };

            navigationRef.current.navigate("Main", {
              screen: "Friends",
              params,
            });
          } else {
            console.warn("Navigation ref or senderId not available");
          }
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

  // Set up notification listeners
  useEffect(() => {
    if (!sessionId) {
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
      Notifications.addNotificationReceivedListener((incoming) => {
        console.log("Notification received:", incoming);
        setNotification(incoming);

        // Invalidate queries based on notification type to prefetch fresh data
        const data = incoming.request.content.data;
        if (data.type === "message") {
          console.log("Invalidating inbox query for new message notification");
          // This will cause the inbox to refetch in the background
          void utils.messages.inbox.invalidate();
          void utils.friends.list.invalidate();
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
    sessionId,
    handleNotificationResponse,
    utils.messages.inbox,
    utils.friends.list,
    utils.friends.incomingRequests,
  ]);

  return {
    expoPushToken,
    notification,
  };
}
