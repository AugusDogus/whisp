import { useState } from "react";
import { Alert, Modal, ScrollView, View } from "react-native";

import { Button } from "heroui-native/button";

import { SafeAreaView } from "~/components/styled";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";

export function BlockedUsers() {
  const [open, setOpen] = useState(false);
  const users = trpc.safety.blockedUsers.useQuery(undefined, { enabled: open });
  const utils = trpc.useUtils();
  const unblock = trpc.safety.unblock.useMutation({
    onSuccess: () => {
      void utils.invalidate();
    },
    onError: (error) => Alert.alert("Could not unblock account", error.message),
  });
  return (
    <>
      <Button ph-no-capture variant="outline" onPress={() => setOpen(true)}>
        Blocked accounts
      </Button>
      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView ph-no-capture className="flex-1 bg-background">
          <ScrollView contentContainerClassName="gap-4 p-5">
            <Text className="text-2xl font-semibold">Blocked accounts</Text>
            <Text className="text-muted">
              Unblocking allows new contact. It does not restore your friendship
              or old messages.
            </Text>
            {users.isPending && <Text>Loading…</Text>}
            {users.error && (
              <>
                <Text className="text-danger">
                  Could not load blocked accounts.
                </Text>
                <Button onPress={() => void users.refetch()}>Try again</Button>
              </>
            )}
            {users.data?.length === 0 && <Text>No blocked accounts.</Text>}
            {users.data?.map((user) => (
              <View
                key={user.id}
                className="flex-row items-center justify-between gap-3"
              >
                <Text className="flex-1">{user.name}</Text>
                <Button
                  variant="outline"
                  isDisabled={unblock.isPending}
                  onPress={() =>
                    Alert.alert(
                      `Unblock ${user.name}?`,
                      "This account will be able to send you friend requests again.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Unblock",
                          onPress: () => unblock.mutate({ userId: user.id }),
                        },
                      ],
                    )
                  }
                >
                  Unblock
                </Button>
              </View>
            ))}
            <Button variant="ghost" onPress={() => setOpen(false)}>
              Done
            </Button>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
