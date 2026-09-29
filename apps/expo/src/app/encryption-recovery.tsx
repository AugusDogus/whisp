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
            : "Couldn't reset your encryption keys. Check your connection and try again.",
      });
    }
  };
  return (
    <SettingsPage title="Encryption recovery">
      <View className="bg-surface gap-3 rounded-xl p-4">
        <Text className="text-base font-semibold">Reset encryption keys</Text>
        <Text className="text-sm text-muted">
          If whisp says your encryption keys are missing or damaged, resetting
          gives this device new keys so you can send and receive whisps again.
        </Text>
        <Text className="text-sm text-muted">
          Whisps you received before the reset won't open on this device. Your
          other devices aren't affected.
        </Text>
        {state.kind === "success" && (
          <Text accessibilityLiveRegion="polite">
            Done. This device has new keys and is ready to go.
          </Text>
        )}
        <Button
          variant="secondary"
          onPress={() => {
            setState({ kind: "idle" });
            setOpen(true);
          }}
        >
          <Button.Label>Reset keys</Button.Label>
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
            <Dialog.Title>Reset encryption keys?</Dialog.Title>
            <Dialog.Description>
              Whisps you received before now won't open on this device. This
              can't be undone.
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
                  {state.kind === "pending" ? "Resetting…" : "Reset keys"}
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
