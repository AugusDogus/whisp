import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect } from "react";
import { View } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import { useNavigation } from "@react-navigation/native";
import { usePostHog } from "posthog-react-native";

import type { RootStackParamList } from "~/navigation/types";
import { authClient } from "~/utils/auth";

// Keep the native splash screen visible while we load
void SplashScreen.preventAutoHideAsync();

export default function Splash() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: session, isPending } = authClient.useSession();
  const posthog = usePostHog();

  useEffect(() => {
    if (session?.user) {
      posthog.identify(session.user.id, {
        email: session.user.email,
        name: session.user.name,
      });
    }
  }, [session, posthog]);

  useEffect(() => {
    async function checkAuth() {
      try {
        // First check if we have a cookie (optimistic)
        const cookieRaw = await SecureStore.getItemAsync("whisp_cookie");
        let cookieExists = false;
        if (cookieRaw) {
          try {
            const parsed: unknown = JSON.parse(cookieRaw);
            if (
              parsed &&
              typeof parsed === "object" &&
              "__Secure-better-auth.session_token" in parsed
            ) {
              const tokenObj = (parsed as Record<string, unknown>)[
                "__Secure-better-auth.session_token"
              ];
              if (tokenObj && typeof tokenObj === "object") {
                const rec = tokenObj as Record<string, unknown>;
                const value = typeof rec.value === "string" ? rec.value : "";
                const expiresIso =
                  typeof rec.expires === "string" ? rec.expires : undefined;
                const notExpired =
                  !expiresIso || new Date(expiresIso).getTime() > Date.now();
                cookieExists = value.length > 0 && notExpired;
              }
            }
          } catch {
            cookieExists = false;
          }
        }

        if (cookieExists) {
          // Check if user has completed onboarding
          const onboardingComplete = await SecureStore.getItemAsync(
            "whisp_onboarding_complete",
          );

          if (onboardingComplete === "true") {
            console.log(
              "[Splash] Cookie found, onboarding complete, redirecting to main",
            );
            await SplashScreen.hideAsync();
            navigation.replace("Main");
          } else {
            console.log("[Splash] Cookie found, redirecting to onboarding");
            await SplashScreen.hideAsync();
            navigation.replace("Onboarding");
          }
          return;
        }

        // No cookie, wait for session check
        if (!isPending && !session) {
          console.log("[Splash] No session, redirecting to login");
          await SplashScreen.hideAsync();
          navigation.replace("Login");
        }
      } catch (error) {
        console.error("[Splash] Error during auth check:", error);
        // Hide splash screen even on error to prevent infinite loading
        await SplashScreen.hideAsync();
        navigation.replace("Login");
      }
    }

    void checkAuth();
  }, [isPending, session, navigation]);

  // Return an empty view - the native splash screen is still visible
  return <View className="flex-1" />;
}
