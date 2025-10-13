import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

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

  // Request permissions early (before auth)
  useEffect(() => {
    let mounted = true;

    requestNotificationPermissions()
      .then((granted) => {
        if (mounted) {
          setPermissionsGranted(granted);
        }
      })
      .catch((error) => {
        console.error("Failed to request notification permissions:", error);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Register token only after authentication
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

    // Listen for notifications received while app is foregrounded
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        setNotification(notification);
      });

    // Listen for notification taps
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        console.log("Notification tapped:", response);
        // Handle navigation based on notification data
      });

    return () => {
      mounted = false;
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, permissionsGranted]); // Run when authentication or permissions change

  return {
    expoPushToken,
    notification,
  };
}

// Request notification permissions early (called on app start, before auth)
async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  if (!Device.isDevice) {
    console.log("Must use physical device for Push Notifications");
    return false;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
  if (finalStatus !== "granted") {
    console.log("Notification permissions not granted");
    return false;
  }

  return true;
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
