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

  const checking =
    status.isFetching ||
    status.data?.status === "allowed" ||
    status.data?.status === "suspended";

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 px-6 pb-8">
        <ScrollView contentContainerClassName="flex-grow justify-center gap-4 py-8">
          {checking ? (
            <Text className="text-center text-muted">Checking account…</Text>
          ) : (
            <View className="items-center gap-4">
              <View className="bg-default h-24 w-24 items-center justify-center rounded-full">
                <Text className="text-5xl">🤝</Text>
              </View>
              <Text
                accessibilityRole="header"
                className="text-center text-3xl font-bold"
              >
                Before you share
              </Text>
              <Text className="text-center text-lg text-muted">
                By continuing, you confirm you’re 13+ and agree to our terms.
              </Text>
              <TermsLinks />
              {(accept.error || status.isError) && (
                <Text
                  accessibilityRole="alert"
                  className="text-danger text-center"
                >
                  {accept.error?.message ??
                    "Couldn’t load your terms acceptance. Try again, or accept later from Profile."}
                </Text>
              )}
            </View>
          )}
        </ScrollView>

        <View className="gap-3">
          {status.data?.status === "acceptance_required" && !checking && (
            <Button
              size="lg"
              isDisabled={accept.isPending}
              onPress={() => accept.mutate({ version: CONTENT_POLICY_VERSION })}
            >
              <Button.Label className="text-lg font-semibold">
                {accept.isPending ? "Saving…" : "Agree and continue"}
              </Button.Label>
            </Button>
          )}
          {status.isError && !checking && (
            <Button size="lg" onPress={() => void status.refetch()}>
              <Button.Label className="text-lg font-semibold">
                Try again
              </Button.Label>
            </Button>
          )}
          <Button variant="ghost" size="lg" onPress={onContinue}>
            <Button.Label className="text-lg text-muted">Not now</Button.Label>
          </Button>
        </View>
      </View>
    </SafeAreaView>
  );
}
