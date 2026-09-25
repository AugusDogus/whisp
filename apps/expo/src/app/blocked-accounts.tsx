import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";
import { useThemeColor } from "heroui-native/hooks";
import { toast } from "sonner-native";

import { Avatar } from "~/components/ui/avatar";
import { Text } from "~/components/ui/text";
import type { RootStackParamList } from "~/navigation/types";
import { trpc, type RouterOutputs } from "~/utils/api";

type BlockedUser = RouterOutputs["safety"]["blockedUsers"][number];

export default function BlockedAccountsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const [foregroundColor, mutedColor] = useThemeColor(["foreground", "muted"]);
  const [confirming, setConfirming] = useState<BlockedUser | null>(null);
  const users = trpc.safety.blockedUsers.useQuery();
  const utils = trpc.useUtils();
  const unblock = trpc.safety.unblock.useMutation({
    onSuccess: (_data, { userId }) => {
      const name = users.data?.find((user) => user.id === userId)?.name;
      setConfirming(null);
      toast.success(name ? `${name} unblocked` : "Account unblocked");
      void utils.invalidate();
    },
  });

  return (
    <View
      className="flex-1 bg-background"
      style={{
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      <View className="flex-row items-center gap-2 px-4 py-3">
        <Pressable
          onPress={() => navigation.goBack()}
          className="size-10 items-center justify-center rounded-full"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={foregroundColor} />
        </Pressable>
        <Text className="flex-1 text-lg font-semibold">Blocked accounts</Text>
      </View>

      {users.isPending ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={mutedColor} />
        </View>
      ) : users.error ? (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <Text className="text-center text-muted">
            Couldn’t load blocked accounts.
          </Text>
          <Button size="sm" onPress={() => void users.refetch()}>
            Try again
          </Button>
        </View>
      ) : users.data.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <View className="bg-surface mb-2 size-16 items-center justify-center rounded-full">
            <Ionicons name="ban" size={28} color={mutedColor} />
          </View>
          <Text className="text-base font-semibold">No blocked accounts</Text>
          <Text className="text-center text-sm text-muted">
            Block someone from their profile, a message, or a friend request.
          </Text>
        </View>
      ) : (
        <ScrollView ph-no-capture className="flex-1">
          <View className="gap-3 px-4 pb-4">
            <View className="bg-surface rounded-xl">
              {users.data.map((user, index) => (
                <View key={user.id}>
                  <View className="flex-row items-center gap-3 px-4 py-3">
                    <Avatar
                      userId={user.id}
                      image={user.image}
                      name={user.name}
                      size={36}
                    />
                    <Text className="flex-1 text-sm">{user.name}</Text>
                    <Button
                      size="sm"
                      variant="secondary"
                      isDisabled={unblock.isPending}
                      onPress={() => {
                        unblock.reset();
                        setConfirming(user);
                      }}
                    >
                      Unblock
                    </Button>
                  </View>
                  {index < users.data.length - 1 && (
                    <View className="bg-separator mx-4 h-px" />
                  )}
                </View>
              ))}
            </View>
            <Text className="px-1 text-xs text-muted">
              Unblocking lets them send you friend requests again. It won’t
              restore your friendship or old messages.
            </Text>
          </View>
        </ScrollView>
      )}

      <Dialog
        isOpen={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !unblock.isPending) setConfirming(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Unblock {confirming?.name}?</Dialog.Title>
            <Dialog.Description>
              They’ll be able to send you friend requests again.
            </Dialog.Description>
            {unblock.error && (
              <Text accessibilityRole="alert" className="text-danger pt-2">
                Couldn’t unblock. {unblock.error.message}
              </Text>
            )}
            <View className="flex-row justify-end gap-3 pt-4">
              <Button
                variant="ghost"
                size="sm"
                isDisabled={unblock.isPending}
                onPress={() => setConfirming(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                isDisabled={unblock.isPending}
                onPress={() => {
                  if (confirming) unblock.mutate({ userId: confirming.id });
                }}
              >
                {unblock.isPending ? "Unblocking…" : "Unblock"}
              </Button>
            </View>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </View>
  );
}
