import { Dimensions, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";

export const CONTENT_SPACING = 15;

// Hook to get safe area padding with content spacing
export function useSafeAreaPadding() {
  const insets = useSafeAreaInsets();

  const SAFE_BOTTOM =
    Platform.select({
      ios: insets.bottom,
    }) ?? 0;

  return {
    paddingLeft: insets.left + CONTENT_SPACING,
    paddingTop: insets.top + CONTENT_SPACING,
    paddingRight: insets.right + CONTENT_SPACING,
    paddingBottom: SAFE_BOTTOM + CONTENT_SPACING,
  };
}

// The maximum zoom _factor_ you should be able to zoom in
export const MAX_ZOOM_FACTOR = 10;

export const SCREEN_WIDTH = Dimensions.get("window").width;

// Hook to get screen height adjusted for safe areas
export function useScreenHeight() {
  const insets = useSafeAreaInsets();

  return (
    Platform.select<number>({
      android: Dimensions.get("screen").height - insets.bottom,
      ios: Dimensions.get("window").height,
    }) ?? Dimensions.get("window").height
  );
}

// Capture Button
export const CAPTURE_BUTTON_SIZE = 78;

// Control Button like Flash
export const CONTROL_BUTTON_SIZE = 40;

// PostHog Analytics (optional - gracefully degrades if not available)
export const POSTHOG_API_KEY = process.env
  .EXPO_PUBLIC_POSTHOG_API_KEY as string;
export const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST as string;

// Expo Push Notifications - read from app.config.ts via Constants
interface ExpoConfigExtra {
  eas?: {
    projectId?: string;
  };
}

const expoConfigExtra = Constants.expoConfig?.extra as
  | ExpoConfigExtra
  | undefined;
export const EXPO_PROJECT_ID = expoConfigExtra?.eas?.projectId ?? "";
