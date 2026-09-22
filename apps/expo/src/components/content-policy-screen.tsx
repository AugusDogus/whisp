import { useEffect } from "react";
import { Linking, ScrollView, View } from "react-native";

import { Button } from "heroui-native/button";

import { CONTENT_POLICY_VERSION } from "@acme/validators";

import { SafeAreaView } from "~/components/styled";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";

export function ContentPolicyScreen({
  mode,
  onContinue,
}: {
  mode: "onboarding" | "review";
  onContinue: () => void;
}) {
  const status = trpc.safety.status.useQuery(undefined, { staleTime: 0 });
  const utils = trpc.useUtils();
  const accept = trpc.safety.acceptPolicy.useMutation({
    onSuccess: () => {
      utils.safety.status.setData(undefined, { status: "allowed" });
      if (mode === "review") onContinue();
    },
  });
  useEffect(() => {
    if (
      mode === "onboarding" &&
      !status.isFetching &&
      (status.data?.status === "allowed" || status.data?.status === "suspended")
    ) {
      onContinue();
    }
  }, [mode, status.isFetching, status.data?.status, onContinue]);

  if (
    mode === "onboarding" &&
    (status.isFetching ||
      status.data?.status === "allowed" ||
      status.data?.status === "suspended")
  ) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center gap-5 p-6">
          <Text className="text-muted">Checking account…</Text>
          <Button variant="ghost" onPress={onContinue}>
            Not now
          </Button>
        </View>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="flex-grow justify-center gap-5 p-6">
        <Text className="text-2xl font-semibold">Before you share</Text>
        <Text>
          whisp is for people ages 13 and older. Treat people with respect and
          share only content you have permission to send.
        </Text>
        <Text>
          No harassment, threats, spam, sexual exploitation, child abuse
          material, non-consensual intimate images, or illegal content.
        </Text>
        <Text>
          You can block or report an account from a friend profile, received
          message, friend request, or group member list. Reports are reviewed by
          the whisp team and may lead to suspension.
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
            onPress={() => void Linking.openURL("https://whisp.chat/privacy")}
          >
            Read the privacy policy
          </Button>
        </View>
        {(accept.error || status.isError) && (
          <Text accessibilityRole="alert" className="text-danger">
            {accept.error?.message ??
              "Could not load your terms acceptance. Try again, or come back from Profile."}
          </Text>
        )}
        {status.data?.status === "acceptance_required" && (
          <Button
            isDisabled={accept.isPending}
            onPress={() => accept.mutate({ version: CONTENT_POLICY_VERSION })}
          >
            {accept.isPending ? "Saving…" : "Agree and continue"}
          </Button>
        )}
        {status.isPending && (
          <Text className="text-muted">Checking terms acceptance…</Text>
        )}
        {status.isError && (
          <Button variant="outline" onPress={() => void status.refetch()}>
            Try again
          </Button>
        )}
        <Text className="text-sm text-muted">
          By selecting Agree and continue, you confirm you are at least 13 and
          accept the terms of service, including these rules.
        </Text>
        <Button variant="ghost" onPress={onContinue}>
          {status.data?.status === "allowed" ? "Done" : "Not now"}
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
