import { useState } from "react";
import { Linking, Modal, ScrollView, View } from "react-native";

import { Button } from "heroui-native/button";

import { CONTENT_POLICY_VERSION } from "@acme/validators";

import { SafeAreaView } from "~/components/styled";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";

// Sharing is enforced by the server. This notice never owns navigation or account controls.
export function ContentPolicyNotice() {
  const { data: session } = authClient.useSession();
  const [reviewing, setReviewing] = useState(false);
  const status = trpc.safety.status.useQuery(undefined, {
    enabled: !!session,
    staleTime: 0,
  });
  const utils = trpc.useUtils();
  const accept = trpc.safety.acceptPolicy.useMutation({
    onSuccess: async () => {
      await utils.safety.status.invalidate();
      setReviewing(false);
    },
  });
  if (!session || status.data?.status === "allowed") return null;
  return (
    <>
      <SafeAreaView edges={["top"]} className="bg-surface gap-2 p-3">
        {status.data?.status === "suspended" ? (
          <Text>
            Sharing is suspended. Contact augie@luebbers.email to appeal. Your
            account settings remain available.
          </Text>
        ) : status.data?.status === "acceptance_required" ? (
          <>
            <Text>
              Review the current terms before sharing. Account settings and
              safety controls remain available.
            </Text>
            <Button variant="outline" onPress={() => setReviewing(true)}>
              Review terms
            </Button>
          </>
        ) : status.isPending ? (
          <Text>Checking sharing permissions…</Text>
        ) : (
          <>
            <Text>
              Could not verify sharing permissions. Your account settings remain
              available.
            </Text>
            <Button variant="outline" onPress={() => void status.refetch()}>
              Try again
            </Button>
          </>
        )}
      </SafeAreaView>
      {reviewing && status.data?.status === "acceptance_required" && (
        <Modal
          visible
          animationType="slide"
          onRequestClose={() => setReviewing(false)}
        >
          <SafeAreaView className="flex-1 bg-background">
            <ScrollView contentContainerClassName="flex-grow justify-center gap-5 p-6">
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
                You can block or report an account from a friend profile,
                received message, friend request, or group member list. Reports
                are reviewed by the whisp team and may lead to suspension.
              </Text>
              <View className="gap-2">
                <Button
                  variant="outline"
                  onPress={() =>
                    void Linking.openURL("https://whisp.chat/terms")
                  }
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
                onPress={() =>
                  accept.mutate({ version: CONTENT_POLICY_VERSION })
                }
              >
                {accept.isPending ? "Saving…" : "Agree and continue"}
              </Button>
              <Text className="text-sm text-muted">
                By continuing, you confirm you are at least 13 and accept the
                terms of service, including these rules.
              </Text>
              <Button variant="ghost" onPress={() => setReviewing(false)}>
                Not now
              </Button>
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </>
  );
}
