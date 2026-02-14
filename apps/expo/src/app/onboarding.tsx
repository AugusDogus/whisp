import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import {
  check,
  checkNotifications,
  PERMISSIONS,
  request,
  requestNotifications,
  RESULTS,
} from "react-native-permissions";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { useNavigation } from "@react-navigation/native";

import type { RootStackParamList } from "~/navigation/types";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";
import { EXPO_PROJECT_ID } from "~/utils/constants";

type PermissionStep = "camera" | "microphone" | "notifications" | "complete";

export default function OnboardingScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [currentStep, setCurrentStep] = useState<PermissionStep | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isCheckingPermissions, setIsCheckingPermissions] = useState(true);

  const registerToken = trpc.notifications.registerPushToken.useMutation();

  // Check existing permissions on mount and determine starting step
  useEffect(() => {
    async function checkPermissions() {
      try {
        const cameraStatus = await check(
          Platform.OS === "ios"
            ? PERMISSIONS.IOS.CAMERA
            : PERMISSIONS.ANDROID.CAMERA,
        );
        const microphoneStatus = await check(
          Platform.OS === "ios"
            ? PERMISSIONS.IOS.MICROPHONE
            : PERMISSIONS.ANDROID.RECORD_AUDIO,
        );
        const { status: notificationStatus } = await checkNotifications();

        // Determine first step that needs permission

        if (cameraStatus !== RESULTS.GRANTED) {
          setCurrentStep("camera");
        } else if (microphoneStatus !== RESULTS.GRANTED) {
          setCurrentStep("microphone");
        } else if (notificationStatus !== RESULTS.GRANTED) {
          setCurrentStep("notifications");
        } else {
          // All permissions granted, go to main
          setCurrentStep("complete");
        }
      } catch (error) {
        console.error("Error checking permissions:", error);
        // Default to camera if check fails
        setCurrentStep("camera");
      } finally {
        setIsCheckingPermissions(false);
      }
    }

    void checkPermissions();
  }, []);

  const requestCameraPermission = async () => {
    setIsRequesting(true);
    try {
      await request(
        Platform.OS === "ios"
          ? PERMISSIONS.IOS.CAMERA
          : PERMISSIONS.ANDROID.CAMERA,
      );
      // Check next permission needed
      const microphoneStatus = await check(
        Platform.OS === "ios"
          ? PERMISSIONS.IOS.MICROPHONE
          : PERMISSIONS.ANDROID.RECORD_AUDIO,
      );

      if (microphoneStatus !== RESULTS.GRANTED) {
        setCurrentStep("microphone");
      } else {
        const { status: notificationStatus } = await checkNotifications();

        if (notificationStatus !== RESULTS.GRANTED) {
          setCurrentStep("notifications");
        } else {
          setCurrentStep("complete");
        }
      }
    } catch (error) {
      console.error("Error requesting camera permission:", error);
      setCurrentStep("microphone");
    } finally {
      setIsRequesting(false);
    }
  };

  const requestMicrophonePermission = async () => {
    setIsRequesting(true);
    try {
      await request(
        Platform.OS === "ios"
          ? PERMISSIONS.IOS.MICROPHONE
          : PERMISSIONS.ANDROID.RECORD_AUDIO,
      );
      // Check next permission needed
      const { status: notificationStatus } = await checkNotifications();
      if (notificationStatus !== RESULTS.GRANTED) {
        setCurrentStep("notifications");
      } else {
        setCurrentStep("complete");
      }
    } catch (error) {
      console.error("Error requesting microphone permission:", error);
      setCurrentStep("notifications");
    } finally {
      setIsRequesting(false);
    }
  };

  const requestNotificationPermission = async () => {
    setIsRequesting(true);
    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#ffffff",
        });
      }

      if (Device.isDevice) {
        const { status } = await requestNotifications([
          "alert",
          "sound",
          "badge",
        ]);

        // If permission granted, register the push token
        if (status === RESULTS.GRANTED) {
          try {
            const pushToken = await Notifications.getExpoPushTokenAsync({
              projectId: EXPO_PROJECT_ID,
            });

            // Register token with backend
            registerToken.mutate({
              token: pushToken.data,
              platform: Platform.OS === "ios" ? "ios" : "android",
            });
          } catch (tokenError) {
            console.error("Error registering push token:", tokenError);
            // Don't block onboarding if token registration fails
          }
        }
      }

      setCurrentStep("complete");
    } catch (error) {
      console.error("Error requesting notification permission:", error);
      setCurrentStep("complete");
    } finally {
      setIsRequesting(false);
    }
  };

  const handleSkip = () => {
    // Only notifications can be skipped
    if (currentStep === "notifications") {
      setCurrentStep("complete");
    }
  };

  // Handle navigation to Main when onboarding is complete
  useEffect(() => {
    if (currentStep === "complete") {
      // Mark onboarding as complete
      void SecureStore.setItemAsync("whisp_onboarding_complete", "true").then(
        () => {
          navigation.replace("Main");
        },
      );
    }
  }, [currentStep, navigation]);

  if (currentStep === "complete") {
    return null;
  }

  // Show loading while checking permissions
  if (isCheckingPermissions || currentStep === null) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted-foreground">Checking permissions...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 px-6 pb-8">
        {/* Progress dots */}
        <View className="flex-row justify-center gap-2 py-8">
          <View
            className={`h-2 w-2 rounded-full ${
              currentStep === "camera" ? "bg-primary" : "bg-muted"
            }`}
          />
          <View
            className={`h-2 w-2 rounded-full ${
              currentStep === "microphone" ? "bg-primary" : "bg-muted"
            }`}
          />
          <View
            className={`h-2 w-2 rounded-full ${
              currentStep === "notifications" ? "bg-primary" : "bg-muted"
            }`}
          />
        </View>

        {/* Content */}
        <View className="flex-1 justify-center gap-6">
          {currentStep === "camera" && (
            <>
              <View className="items-center gap-4">
                <View className="h-24 w-24 items-center justify-center rounded-full bg-primary/10">
                  <Text className="text-5xl">📷</Text>
                </View>
                <Text className="text-center text-3xl font-bold">
                  Camera Access
                </Text>
                <Text className="text-center text-lg text-muted-foreground">
                  Whisp needs camera access to capture and send photos and
                  videos to your friends.
                </Text>
              </View>
            </>
          )}

          {currentStep === "microphone" && (
            <>
              <View className="items-center gap-4">
                <View className="h-24 w-24 items-center justify-center rounded-full bg-primary/10">
                  <Text className="text-5xl">🎤</Text>
                </View>
                <Text className="text-center text-3xl font-bold">
                  Microphone Access
                </Text>
                <Text className="text-center text-lg text-muted-foreground">
                  Enable microphone access to record videos with sound.
                </Text>
              </View>
            </>
          )}

          {currentStep === "notifications" && (
            <>
              <View className="items-center gap-4">
                <View className="h-24 w-24 items-center justify-center rounded-full bg-primary/10">
                  <Text className="text-5xl">🔔</Text>
                </View>
                <Text className="text-center text-3xl font-bold">
                  Stay Updated
                </Text>
                <Text className="text-center text-lg text-muted-foreground">
                  Get notified when friends send you whisps or accept your
                  friend requests.
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Actions */}
        <View className="gap-3">
          <Button
            onPress={
              currentStep === "camera"
                ? requestCameraPermission
                : currentStep === "microphone"
                  ? requestMicrophonePermission
                  : requestNotificationPermission
            }
            disabled={isRequesting}
            size="lg"
          >
            <Text className="text-lg font-semibold text-primary-foreground">
              {isRequesting ? "Please wait..." : "Allow"}
            </Text>
          </Button>
          {currentStep === "notifications" && (
            <Button
              variant="ghost"
              onPress={handleSkip}
              disabled={isRequesting}
              size="lg"
            >
              <Text className="text-lg text-muted-foreground">Maybe Later</Text>
            </Button>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
