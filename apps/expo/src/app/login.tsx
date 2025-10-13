import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";

import type { RootStackParamList } from "~/navigation/types";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Text } from "~/components/ui/text";
import { authClient } from "~/utils/auth";

export default function LoginPage() {
  const { data: session } = authClient.useSession();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  useEffect(() => {
    if (session) {
      navigation.reset({ index: 0, routes: [{ name: "Onboarding" }] });
    }
  }, [session, navigation]);

  return (
    <SafeAreaView className="bg-background">
      <View className="h-full w-full items-center justify-center px-6 py-10">
        <View className="w-full max-w-xl">
          <Card className="w-full">
            <CardHeader className="items-center">
              <CardTitle>
                <Text variant="h1" className="mb-6 text-primary">
                  whisp
                </Text>
              </CardTitle>
              <CardDescription className="mt-2 text-center">
                Sign in to continue
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button
                variant="default"
                disabled={isSigningIn}
                onPress={async () => {
                  setIsSigningIn(true);
                  await authClient.signIn.social({
                    provider: "discord",
                    callbackURL: "/camera",
                  });
                }}
              >
                <Text>Continue with Discord</Text>
              </Button>
            </CardContent>
          </Card>
        </View>
      </View>

      {isSigningIn && (
        <View
          className="absolute inset-0 z-50 items-center justify-center bg-background/80"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        >
          <ActivityIndicator size="large" color="white" />
        </View>
      )}
    </SafeAreaView>
  );
}
