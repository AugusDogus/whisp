import { useEffect, useRef, useState } from "react";
import { Linking, Modal, ScrollView, View } from "react-native";

import { useIsFocused } from "@react-navigation/native";
import { Button } from "heroui-native/button";

import { CONTENT_POLICY_VERSION } from "@acme/validators";

import { SafeAreaView } from "~/components/styled";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";

type Prompt =
  | { status: "closed" }
  | { status: "checking" }
  | { status: "terms"; saving: boolean; error?: string }
  | { status: "error"; message: string; retry: boolean };

type Attempt = { resolve: (allowed: boolean) => void };

// Local to the sending screen: leaving it cancels the pending send, including
// in-flight checks/acceptance. No upload or navigation happens before true.
export function useSendWithTerms() {
  const utils = trpc.useUtils();
  const focused = useIsFocused();
  const [prompt, setPrompt] = useState<Prompt>({ status: "closed" });
  const pending = useRef<Attempt | null>(null);
  const accepting = useRef(false);

  useEffect(() => {
    setPrompt({ status: "closed" });
    return () => {
      pending.current?.resolve(false);
      pending.current = null;
    };
  }, [focused]);

  function finish(allowed: boolean) {
    const attempt = pending.current;
    pending.current = null;
    setPrompt({ status: "closed" });
    attempt?.resolve(allowed);
  }

  async function check(attempt: Attempt) {
    setPrompt({ status: "checking" });
    try {
      const access = await utils.safety.status.fetch(undefined, {
        staleTime: 0,
      });
      if (pending.current !== attempt) return;
      if (access.status === "allowed") finish(true);
      else if (access.status === "acceptance_required")
        setPrompt({ status: "terms", saving: false });
      else
        setPrompt({
          status: "error",
          message:
            access.status === "suspended"
              ? "Sharing is suspended. Contact augie@luebbers.email to appeal."
              : "Could not verify your account. Sign in again before sending.",
          retry: false,
        });
    } catch {
      if (pending.current === attempt)
        setPrompt({
          status: "error",
          message:
            "Could not check sharing permissions. Nothing was sent. Try again.",
          retry: true,
        });
    }
  }

  function confirmSend(): Promise<boolean> {
    if (!focused || pending.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      const attempt = { resolve };
      pending.current = attempt;
      void check(attempt);
    });
  }

  async function accept() {
    const attempt = pending.current;
    if (!attempt || accepting.current) return;
    accepting.current = true;
    setPrompt({ status: "terms", saving: true });
    try {
      await utils.client.safety.acceptPolicy.mutate({
        version: CONTENT_POLICY_VERSION,
      });
      // Recheck after acceptance so a suspension imposed during the dialog wins.
      if (pending.current === attempt) await check(attempt);
    } catch {
      if (pending.current === attempt)
        setPrompt({
          status: "terms",
          saving: false,
          error: "Could not save acceptance. Nothing was sent. Try again.",
        });
    } finally {
      accepting.current = false;
    }
  }

  const dialog =
    focused && prompt.status !== "closed" && prompt.status !== "checking" ? (
      <Modal transparent visible onRequestClose={() => finish(false)}>
        <SafeAreaView className="flex-1 justify-center bg-black/60 p-5">
          <View
            accessibilityViewIsModal
            className="bg-overlay max-h-full w-full max-w-md self-center rounded-3xl p-5"
          >
            <ScrollView contentContainerClassName="gap-2">
              <Text accessibilityRole="header" className="text-lg font-medium">
                {prompt.status === "terms"
                  ? "Accept terms to send"
                  : "Before you send"}
              </Text>
              {prompt.status === "terms" ? (
                <Text className="text-base text-muted">
                  You only need to do this once. Review the{" "}
                  <Text
                    accessibilityRole="link"
                    className="text-foreground underline"
                    onPress={() =>
                      void Linking.openURL("https://whisp.chat/terms")
                    }
                  >
                    Terms of Service
                  </Text>{" "}
                  and{" "}
                  <Text
                    accessibilityRole="link"
                    className="text-foreground underline"
                    onPress={() =>
                      void Linking.openURL("https://whisp.chat/privacy")
                    }
                  >
                    Privacy Policy
                  </Text>
                  .
                </Text>
              ) : (
                <Text
                  accessibilityRole="alert"
                  className="text-base text-muted"
                >
                  {prompt.message}
                </Text>
              )}
              {prompt.status === "terms" && prompt.error && (
                <Text accessibilityRole="alert" className="text-danger">
                  {prompt.error}
                </Text>
              )}
              <View className="flex-row justify-end gap-3 pt-2">
                <Button variant="ghost" size="sm" onPress={() => finish(false)}>
                  Cancel
                </Button>
                {prompt.status === "terms" ? (
                  <Button
                    size="sm"
                    isDisabled={prompt.saving}
                    onPress={() => void accept()}
                  >
                    {prompt.saving ? "Saving…" : "Accept and send"}
                  </Button>
                ) : (
                  prompt.retry && (
                    <Button
                      size="sm"
                      onPress={() => {
                        if (pending.current) void check(pending.current);
                      }}
                    >
                      Try again
                    </Button>
                  )
                )}
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    ) : null;

  return { confirmSend, dialog };
}
