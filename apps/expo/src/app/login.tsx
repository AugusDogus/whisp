import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useEffect, useState } from "react";
import { ActivityIndicator, useColorScheme, View } from "react-native";

import { Image } from "expo-image";

import { useNavigation } from "@react-navigation/native";
import { Button } from "heroui-native/button";
import { usePostHog } from "posthog-react-native";

import { SafeAreaView } from "~/components/styled";
import { Text } from "~/components/ui/text";
import type { RootStackParamList } from "~/navigation/types";
import { authClient } from "~/utils/auth";

const logoLight = require("../../assets/splash-icon.png") as number;
const logoDark = require("../../assets/splash-icon-dark.png") as number;

export default function LoginPage() {
  const { data: session } = authClient.useSession();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const colorScheme = useColorScheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const posthog = usePostHog();

  useEffect(() => {
    if (session) {
      posthog.identify(session.user.id, {
        email: session.user.email,
        name: session.user.name,
      });
      navigation.reset({ index: 0, routes: [{ name: "Onboarding" }] });
    }
  }, [session, navigation, posthog]);

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 items-center justify-center px-8">
        <View className="items-center gap-12">
          <View className="items-center gap-4">
            <Image
              source={colorScheme === "dark" ? logoDark : logoLight}
              style={{ width: 64, height: 64 }}
              contentFit="contain"
            />
            <Text className="text-3xl font-bold">whisp</Text>
            <Text className="text-sm text-muted">Sign in to continue</Text>
          </View>

          <Button
            variant="primary"
            isDisabled={isSigningIn}
            onPress={async () => {
              setIsSigningIn(true);
              await authClient.signIn.social({
                provider: "discord",
                callbackURL: "/camera",
              });
            }}
          >
            Continue with Discord
          </Button>
        </View>
      </View>

      {isSigningIn && (
        <View className="absolute inset-0 z-50 items-center justify-center bg-background/80">
          <ActivityIndicator size="large" />
        </View>
      )}
    </SafeAreaView>
  );
}
