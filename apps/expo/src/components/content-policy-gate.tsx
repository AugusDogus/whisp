import type { ReactNode } from "react";
import { useEffect } from "react";
import { Linking, ScrollView, View } from "react-native";

import * as SplashScreen from "expo-splash-screen";

import { Button } from "heroui-native/button";

import { CONTENT_POLICY_VERSION } from "@acme/validators";

import { SafeAreaView } from "~/components/styled";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";

export function ContentPolicyGate({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession();
  const status = trpc.safety.status.useQuery(undefined, {
    enabled: !!session,
    staleTime: 0,
  });
  const utils = trpc.useUtils();
  const accept = trpc.safety.acceptPolicy.useMutation({
    onSuccess: () => utils.safety.status.invalidate(),
  });
  const needsGate =
    !!session &&
    (status.isPending ||
      (status.isError && !status.data) ||
      status.data?.status === "acceptance_required" ||
      status.data?.status === "unavailable");
  useEffect(() => {
    if (needsGate) void SplashScreen.hideAsync();
  }, [needsGate]);
  if (!needsGate)
    return (
      <>
        {status.data?.status === "suspended" && (
          <SafeAreaView edges={["top"]} className="bg-surface p-3">
            <Text>
              Sharing is suspended. Contact augie@luebbers.email to appeal. Your
              account settings remain available.
            </Text>
          </SafeAreaView>
        )}
        {children}
      </>
    );
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="flex-grow justify-center gap-5 p-6">
        {status.isPending ? (
          <Text>Checking account…</Text>
        ) : status.data?.status === "acceptance_required" ? (
          <>
            <Text className="text-2xl font-semibold">Before you share</Text>
            <Text>
              whisp is for people ages 13 and older. Treat people with respect
              and share only content you have permission to send.
            </Text>
            <Text>
              No harassment, threats, spam, sexual exploitation, child abuse
              material, non-consensual intimate images, or illegal content.
            </Text>
            <Text>
              You can block or report an account from a friend profile, received
              message, friend request, or group member list. Reports are
              reviewed by the whisp team and may lead to suspension.
            </Text>
            <View className="gap-2">
              <Button
                variant="outline"
                onPress={() => void Linking.openURL("https://whisp.chat/terms")}
              >
                Read the terms of service
              </Button>
              <Button
                variant="outline"
                onPress={() =>
                  void Linking.openURL("https://whisp.chat/privacy")
                }
              >
                Read the privacy policy
              </Button>
            </View>
            {accept.error && (
              <Text accessibilityRole="alert" className="text-danger">
                {accept.error.message}
              </Text>
            )}
            <Button
              isDisabled={accept.isPending}
              onPress={() => accept.mutate({ version: CONTENT_POLICY_VERSION })}
            >
              {accept.isPending ? "Saving…" : "Agree and continue"}
            </Button>
            <Text className="text-sm text-muted">
              By continuing, you confirm you are at least 13 and accept the
              terms of service, including these rules.
            </Text>
          </>
        ) : (
          <>
            <Text>
              Could not verify your account. Check your connection and try
              again.
            </Text>
            <Button onPress={() => void status.refetch()}>Try again</Button>
          </>
        )}
        <Button variant="ghost" onPress={() => void authClient.signOut()}>
          Sign out
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
