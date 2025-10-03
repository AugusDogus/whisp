import Constants from "expo-constants";

/**
 * Extend this function when going to production by
 * setting the baseUrl to your production API URL.
 */
export const getBaseUrl = (): string => {
  /**
   * EXPO_PUBLIC_API_URL: Optional override
   * - For local dev with OAuth: Set to a publicly accessible URL (e.g., via Cloudflare Tunnel, ngrok, etc.)
   * - Leave unset to auto-detect local IP
   */
  if (
    typeof process.env.EXPO_PUBLIC_API_URL === "string" &&
    process.env.EXPO_PUBLIC_API_URL.length > 0
  ) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // Auto-detect based on environment
  const localhost = Constants.expoConfig?.hostUri?.split(":")[0];

  if (!localhost) {
    // No debugger host = production build
    return "https://whisp.chat";
  }

  // Development: auto-detect localhost IP (add to trustedOrigins in auth config for OAuth to work)
  return `http://${localhost}:3000`;
};
