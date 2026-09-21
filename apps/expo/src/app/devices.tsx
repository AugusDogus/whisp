import { useCallback, useState } from "react";
import { View } from "react-native";

import { useFocusEffect } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";

import { SettingsPage } from "~/components/settings-page";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { registerDevice, withEncryptionDevice } from "~/utils/mls-device";

export default function DevicesScreen() {
  const utils = trpc.useUtils();
  const devices = trpc.mls.devices.useQuery();
  const { data: session } = authClient.useSession();
  const identity = useQuery({
    queryKey: ["encryption-device", session?.user.id],
    queryFn: async () => {
      const id = await withEncryptionDevice(async (device) => {
        await registerDevice(device);
        return device.deviceId;
      });
      await utils.mls.devices.invalidate();
      return id;
    },
    gcTime: 0,
    retry: false,
  });
  const [selected, setSelected] = useState<{ id: string; name: string }>();
  const revoke = trpc.mls.revoke.useMutation({
    onSuccess: async () => {
      setSelected(undefined);
      await utils.mls.devices.invalidate();
    },
  });
  const { refetch: refetchIdentity } = identity;
  useFocusEffect(
    useCallback(() => {
      void refetchIdentity();
    }, [refetchIdentity]),
  );

  return (
    <SettingsPage title="Devices">
      <Text className="text-sm text-muted">
        These devices can receive your encrypted whisps. Remove a device if you
        no longer use it or have lost it.
      </Text>
      {identity.isError && (
        <View className="bg-surface gap-3 rounded-xl p-4">
          <Text accessibilityRole="alert">{identity.error.message}</Text>
          <Button variant="secondary" onPress={() => void identity.refetch()}>
            <Button.Label>Try again</Button.Label>
          </Button>
        </View>
      )}
      {devices.error && (
        <View className="bg-surface gap-3 rounded-xl p-4">
          <Text accessibilityRole="alert">
            Couldn't load your devices. {devices.error.message}
          </Text>
          <Button variant="secondary" onPress={() => void devices.refetch()}>
            <Button.Label>Retry</Button.Label>
          </Button>
        </View>
      )}
      {(devices.isLoading || identity.isPending) && (
        <Text className="text-sm text-muted">Loading devices…</Text>
      )}
      {devices.data?.map((device) => {
        const current = identity.isSuccess && device.id === identity.data;
        const name =
          device.name ?? (current ? "This device" : "Unnamed device");
        return (
          <View
            key={device.id}
            className="bg-surface flex-row items-center gap-3 rounded-xl p-4"
          >
            <View className="flex-1 gap-1">
              <Text className="font-semibold">{name}</Text>
              {current && device.name && (
                <Text className="text-sm text-muted">This device</Text>
              )}
              <Text className="text-xs text-muted">
                Added {device.createdAt.toLocaleString()}
              </Text>
            </View>
            {identity.isSuccess && !current && (
              <Button
                variant="secondary"
                accessibilityLabel={`Remove ${name}`}
                onPress={() => {
                  revoke.reset();
                  setSelected({ id: device.id, name });
                }}
              >
                <Button.Label>Remove</Button.Label>
              </Button>
            )}
          </View>
        );
      })}
      {devices.data?.some((device) => !device.name) && (
        <Text className="text-sm text-muted">
          Older installations will show their model name after opening the
          updated app.
        </Text>
      )}
      {identity.isSuccess &&
        devices.data?.length === 0 &&
        !devices.isFetching &&
        !devices.error && (
          <View className="gap-3">
            <Text>No devices listed yet.</Text>
            <Button variant="secondary" onPress={() => void devices.refetch()}>
              <Button.Label>Refresh devices</Button.Label>
            </Button>
          </View>
        )}
      <Dialog
        isOpen={selected !== undefined}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) setSelected(undefined);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Remove {selected?.name}?</Dialog.Title>
            <Dialog.Description>
              This device will stop receiving new whisps. Whisps already
              downloaded cannot be recalled.
            </Dialog.Description>
            {revoke.error && (
              <Text accessibilityRole="alert">{revoke.error.message}</Text>
            )}
            <View className="gap-3 pt-4">
              <Button
                variant="danger"
                isDisabled={revoke.isPending}
                onPress={() => {
                  if (selected) revoke.mutate({ deviceId: selected.id });
                }}
              >
                <Button.Label>
                  {revoke.isPending ? "Removing…" : "Remove device"}
                </Button.Label>
              </Button>
              <Button
                variant="secondary"
                isDisabled={revoke.isPending}
                onPress={() => setSelected(undefined)}
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
