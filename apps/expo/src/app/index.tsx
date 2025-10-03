import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useNavigation } from "@react-navigation/native";

import type { RootStackParamList } from "~/navigation/types";
import { authClient } from "~/utils/auth";

export default function SplashScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    async function checkAuth() {
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
        console.log("[Splash] Cookie found, redirecting to camera");
        navigation.replace("Camera");
        return;
      }

      // No cookie, wait for session check
      if (!isPending && !session) {
        console.log("[Splash] No session, redirecting to login");
        navigation.replace("Login");
      }
    }

    void checkAuth();
  }, [isPending, session, navigation]);

  return (
    <View className="flex-1 items-center justify-center bg-background">
      <ActivityIndicator size="large" color="#0ea5e9" />
    </View>
  );
}
