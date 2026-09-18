import { useEffect, useState } from "react";
import { View } from "react-native";

import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";

import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";
import {
  withEncryptionDevice,
  resetEncryptionDevice,
} from "~/utils/mls-device";
import { configureNativeSends } from "~/utils/native-send";

export function EncryptionDevices() {
  const utils = trpc.useUtils();
  const devices = trpc.mls.devices.useQuery();
  const [currentId, setCurrentId] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetState, setResetState] = useState<
    { kind: "idle" } | { kind: "pending" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const reset = async () => {
    setResetState({ kind: "pending" });
    try {
      await resetEncryptionDevice();
      await configureNativeSends();
      await withEncryptionDevice(async (device) =>
        setCurrentId(device.deviceId),
      );
      await utils.mls.devices.invalidate();
      setResetState({ kind: "idle" });
      setResetOpen(false);
    } catch (error) {
      setResetState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Encryption could not be reset. Retry from Profile.",
      });
    }
  };
  const revoke = trpc.mls.revoke.useMutation({
    onSuccess: async () => {
      setSelected(undefined);
      await utils.mls.devices.invalidate();
    },
  });
  useEffect(() => {
    void withEncryptionDevice(async (device) =>
      setCurrentId(device.deviceId),
    ).catch(() => undefined);
  }, []);
  return (
    <View className="bg-surface gap-3 rounded-xl p-4">
      <Text className="text-base font-semibold">Encryption devices</Text>
      <Text className="text-sm text-muted">
        Remove lost or unused devices so they stop receiving new whisps. Old
        whisps stay on the devices they were sent to.
      </Text>
      {devices.isLoading && (
        <Text className="text-sm text-muted">Loading devices…</Text>
      )}
      {devices.error && (
        <Text accessibilityRole="alert">{devices.error.message}</Text>
      )}
      {devices.data?.map((device) => (
        <View key={device.id} className="flex-row items-center gap-3">
          <View className="flex-1">
            <Text>
              {device.id === currentId
                ? "This device"
                : `Device ${device.id.slice(0, 8)}`}
            </Text>
            <Text className="text-xs text-muted">
              Added {device.createdAt.toLocaleDateString()}
            </Text>
          </View>
          {device.id !== currentId && (
            <Button
              variant="secondary"
              onPress={() => {
                revoke.reset();
                setSelected(device.id);
              }}
            >
              <Button.Label>Remove</Button.Label>
            </Button>
          )}
        </View>
      ))}
      <Button variant="secondary" onPress={() => setResetOpen(true)}>
        <Button.Label>Reset encryption on this device</Button.Label>
      </Button>
      <Dialog isOpen={resetOpen} onOpenChange={setResetOpen}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Reset this device's encryption?</Dialog.Title>
            <Dialog.Description>
              Old whisps will become unreadable on this device. Other
              conversation members must send a new whisp to add your replacement
              identity. This cannot be undone.
            </Dialog.Description>
            {resetState.kind === "error" && (
              <Text accessibilityRole="alert">{resetState.message}</Text>
            )}
            <Button
              variant="danger"
              isDisabled={resetState.kind === "pending"}
              onPress={() => void reset()}
            >
              <Button.Label>Reset encryption</Button.Label>
            </Button>
            <Button
              variant="secondary"
              isDisabled={resetState.kind === "pending"}
              onPress={() => setResetOpen(false)}
            >
              <Button.Label>Cancel</Button.Label>
            </Button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
      <Dialog
        isOpen={selected !== undefined}
        onOpenChange={(open) => {
          if (!open) setSelected(undefined);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Remove encryption device?</Dialog.Title>
            <Dialog.Description>
              This device will no longer receive new whisps. Whisps already
              downloaded cannot be recalled.
            </Dialog.Description>
            {revoke.error && (
              <Text accessibilityRole="alert">{revoke.error.message}</Text>
            )}
            <Button
              variant="danger"
              isDisabled={revoke.isPending}
              onPress={() => {
                if (selected) revoke.mutate({ deviceId: selected });
              }}
            >
              <Button.Label>Remove device</Button.Label>
            </Button>
            <Button variant="secondary" onPress={() => setSelected(undefined)}>
              <Button.Label>Cancel</Button.Label>
            </Button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </View>
  );
}
