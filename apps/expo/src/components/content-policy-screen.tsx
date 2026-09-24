import { useEffect } from "react";
import { ScrollView, View } from "react-native";

import { Button } from "heroui-native/button";

import { CONTENT_POLICY_VERSION } from "@acme/validators";

import { SafeAreaView } from "~/components/styled";
import { TermsLinks } from "~/components/terms-links";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";

export function ContentPolicyScreen({
  onContinue,
}: {
  onContinue: () => void;
}) {
  const status = trpc.safety.status.useQuery(undefined, { staleTime: 0 });
  const utils = trpc.useUtils();
  const accept = trpc.safety.acceptPolicy.useMutation({
    onSuccess: () => {
      utils.safety.status.setData(undefined, { status: "allowed" });
    },
  });
  useEffect(() => {
    if (
      !status.isFetching &&
      (status.data?.status === "allowed" || status.data?.status === "suspended")
    ) {
      onContinue();
    }
  }, [status.isFetching, status.data?.status, onContinue]);

  if (
    status.isFetching ||
    status.data?.status === "allowed" ||
    status.data?.status === "suspended"
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
      <ScrollView contentContainerClassName="flex-grow justify-center px-8 py-8">
        <View className="w-full max-w-sm gap-3 self-center">
          <Text
            accessibilityRole="header"
            className="text-center text-2xl font-semibold"
          >
            Before you share
          </Text>
          <Text className="text-center text-base text-muted">
            By continuing, you confirm you’re 13+ and agree to our terms.
          </Text>
          <TermsLinks />
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
            Not now
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
