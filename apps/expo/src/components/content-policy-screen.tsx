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
      <ScrollView contentContainerClassName="flex-grow px-6 pb-8">
        <View className="flex-1 justify-center gap-5 py-12">
          <Text className="text-center text-3xl font-bold">
            Before you share
          </Text>
          <Text className="text-center text-lg text-muted">
            Respect each other. No harassment, abuse, or illegal content. Block
            or report anyone who crosses the line.
          </Text>
          <View className="flex-row justify-center gap-6">
            <Text
              accessibilityRole="link"
              className="py-3 underline"
              onPress={() => void Linking.openURL("https://whisp.chat/terms")}
            >
              Terms of Service
            </Text>
            <Text
              accessibilityRole="link"
              className="py-3 underline"
              onPress={() => void Linking.openURL("https://whisp.chat/privacy")}
            >
              Privacy Policy
            </Text>
          </View>
        </View>
        <View className="gap-3">
          <Text className="text-center text-sm text-muted">
            By agreeing, you confirm you’re 13 or older and accept our Terms of
            Service.
          </Text>
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
          <Button variant="ghost" onPress={onContinue}>
            {status.data?.status === "allowed" ? "Done" : "Not now"}
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
