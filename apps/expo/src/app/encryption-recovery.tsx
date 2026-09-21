import { useState } from "react";
import { View } from "react-native";

import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";

import { SettingsPage } from "~/components/settings-page";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";
import { resetEncryptionDevice } from "~/utils/mls-device";
import { configureNativeSends } from "~/utils/native-send";

export default function EncryptionRecoveryScreen() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "pending" }
    | { kind: "success" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const reset = async () => {
    setState({ kind: "pending" });
    try {
      await resetEncryptionDevice();
      await configureNativeSends();
      await utils.mls.devices.invalidate();
      setState({ kind: "success" });
      setOpen(false);
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Encryption could not be reset. Try again.",
      });
    }
  };
  return (
    <SettingsPage title="Encryption recovery">
      <View className="bg-surface gap-3 rounded-xl p-4">
        <Text className="text-base font-semibold">
          Reset this device's encryption
        </Text>
        <Text className="text-sm text-muted">
          Only use this if whisp reports missing or damaged encryption keys.
          Resetting creates new keys for this device. It does not recover old
          whisps or fix sign-in problems.
        </Text>
        <Text className="text-sm text-muted">
          Existing whisps will become unreadable on this device. Your other
          devices keep their keys. Someone in each conversation will need to
          send you a new whisp before you can send there again.
        </Text>
        {state.kind === "success" && (
          <Text accessibilityLiveRegion="polite">
            Encryption reset. Ask someone in your conversation to send you a new
            whisp.
          </Text>
        )}
        <Button
          variant="secondary"
          onPress={() => {
            setState({ kind: "idle" });
            setOpen(true);
          }}
        >
          <Button.Label>Reset encryption…</Button.Label>
        </Button>
      </View>
      <Dialog
        isOpen={open}
        onOpenChange={(next) => {
          if (state.kind !== "pending") setOpen(next);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Reset this device's encryption?</Dialog.Title>
            <Dialog.Description>
              Existing whisps will become unreadable on this device. This cannot
              be undone. Your other devices will keep their keys.
            </Dialog.Description>
            {state.kind === "error" && (
              <Text accessibilityRole="alert">{state.message}</Text>
            )}
            <View className="gap-3 pt-4">
              <Button
                variant="danger"
                isDisabled={state.kind === "pending"}
                onPress={() => void reset()}
              >
                <Button.Label>
                  {state.kind === "pending" ? "Resetting…" : "Reset encryption"}
                </Button.Label>
              </Button>
              <Button
                variant="secondary"
                isDisabled={state.kind === "pending"}
                onPress={() => setOpen(false)}
              >
                <Button.Label>Cancel</Button.Label>
              </Button>
            </View>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </SettingsPage>
  );
}
