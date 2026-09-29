import { View } from "react-native";

import { Button } from "heroui-native/button";

import { CONTENT_POLICY_VERSION } from "@acme/validators";

import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";

// Callout at the top of Profile's settings. The server enforces acceptance before sharing.
export function TermsAcceptance() {
  const status = trpc.safety.status.useQuery(undefined, { staleTime: 0 });
  const utils = trpc.useUtils();
  const accept = trpc.safety.acceptPolicy.useMutation({
    onSuccess: () => utils.safety.status.invalidate(),
  });
  if (status.data?.status === "allowed" || status.data?.status === "suspended")
    return null;
  if (
    status.data?.status !== "acceptance_required" &&
    !accept.error &&
    !status.isError
  )
    return null;
  return (
    <View className="bg-surface items-start gap-3 rounded-2xl border border-accent/30 p-4">
      {status.data?.status === "acceptance_required" && (
        <>
          <Text className="text-sm text-muted">
            Accept the Terms of Service to share on whisp.
          </Text>
          <Button
            variant="secondary"
            size="sm"
            isDisabled={accept.isPending}
            onPress={() => accept.mutate({ version: CONTENT_POLICY_VERSION })}
          >
            {accept.isPending ? "Saving…" : "Accept terms"}
          </Button>
        </>
      )}
      {(accept.error || status.isError) && (
        <Text accessibilityRole="alert" className="text-danger text-sm">
          {accept.error?.message ??
            "Could not check terms acceptance. Try again."}
        </Text>
      )}
      {status.isError && (
        <Button variant="ghost" size="sm" onPress={() => void status.refetch()}>
          Try again
        </Button>
      )}
    </View>
  );
}
