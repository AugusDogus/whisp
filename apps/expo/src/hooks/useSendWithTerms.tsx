import { useEffect, useRef, useState } from "react";
import { Modal, ScrollView, View } from "react-native";

import { useIsFocused } from "@react-navigation/native";
import { Button } from "heroui-native/button";

import { CONTENT_POLICY_VERSION } from "@acme/validators";

import { SafeAreaView } from "~/components/styled";
import { TermsLinks } from "~/components/terms-links";
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
        <SafeAreaView className="flex-1 justify-center bg-black/60 p-6">
          <View
            accessibilityViewIsModal
            className="bg-surface max-h-full w-full max-w-sm self-center rounded-2xl p-5"
          >
            <ScrollView contentContainerClassName="gap-1">
              <Text
                accessibilityRole="header"
                className="text-center text-lg font-semibold"
              >
                {prompt.status === "terms"
                  ? "Accept terms to send"
                  : "Before you send"}
              </Text>
              {prompt.status === "terms" ? (
                <>
                  <TermsLinks />
                  {prompt.error && (
                    <Text accessibilityRole="alert" className="text-danger">
                      {prompt.error}
                    </Text>
                  )}
                  <Button
                    isDisabled={prompt.saving}
                    onPress={() => void accept()}
                  >
                    {prompt.saving ? "Saving…" : "Accept and send"}
                  </Button>
                </>
              ) : (
                <>
                  <Text accessibilityRole="alert">{prompt.message}</Text>
                  {prompt.retry && (
                    <Button
                      onPress={() => {
                        if (pending.current) void check(pending.current);
                      }}
                    >
                      Try again
                    </Button>
                  )}
                </>
              )}
              <Button variant="ghost" onPress={() => finish(false)}>
                <Button.Label className="text-sm text-muted">
                  Cancel
                </Button.Label>
              </Button>
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    ) : null;

  return { confirmSend, dialog };
}
