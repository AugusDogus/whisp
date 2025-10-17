import * as SecureStore from "expo-secure-store";

const VIDEO_SAVE_ALERT_KEY = "HAS_SEEN_VIDEO_SAVE_ALERT";

/**
 * Checks if the user has already seen the video save alert
 */
export async function shouldShowVideoSaveAlert(): Promise<boolean> {
  try {
    const hasSeenAlert = await SecureStore.getItemAsync(VIDEO_SAVE_ALERT_KEY);
    return hasSeenAlert !== "true";
  } catch (error) {
    console.error("[VideoSaveAlert] Failed to check alert status:", error);
    return false; // If error, don't show alert
  }
}

/**
 * Marks the video save alert as shown so it won't appear again
 */
export async function markVideoSaveAlertShown(): Promise<void> {
  try {
    await SecureStore.setItemAsync(VIDEO_SAVE_ALERT_KEY, "true");
  } catch (error) {
    console.error("[VideoSaveAlert] Failed to mark alert as shown:", error);
  }
}
