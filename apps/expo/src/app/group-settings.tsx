import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useState } from "react";
import { Pressable, ScrollView, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";
import { Input } from "heroui-native/input";
import { toast } from "sonner-native";

import { Avatar } from "~/components/ui/avatar";
import { Text } from "~/components/ui/text";
import type { RootStackParamList } from "~/navigation/types";
import { trpc } from "~/utils/api";

export default function GroupSettingsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "GroupSettings">>();
  const { groupId } = route.params;
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const iconColor = colorScheme === "dark" ? "#fff" : "#000";

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);

  const { data: group, isLoading } = trpc.groups.get.useQuery(
    { groupId },
    { enabled: !!groupId },
  );

  const utils = trpc.useUtils();
  const rename = trpc.groups.rename.useMutation({
    onSuccess: () => {
      setEditingName(false);
      toast.success("Group renamed");
      void utils.groups.get.invalidate({ groupId });
      void utils.groups.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const leave = trpc.groups.leave.useMutation({
    onSuccess: () => {
      navigation.reset({ index: 0, routes: [{ name: "Main" }] });
    },
    onError: (err) => toast.error(err.message),
  });

  const startEditingName = () => {
    if (group) {
      setNameInput(group.name);
      setEditingName(true);
    }
  };

  const saveName = () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === group?.name) {
      setEditingName(false);
      return;
    }
    rename.mutate({ groupId, name: trimmed });
  };

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
      {/* Header */}
      <View className="flex-row items-center gap-2 px-4 py-3">
        <Pressable
          onPress={() => navigation.goBack()}
          className="size-10 items-center justify-center rounded-full"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={iconColor} />
        </Pressable>
        <Text className="flex-1 text-lg font-semibold">Group Settings</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted">Loading...</Text>
        </View>
      ) : !group ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted">Group not found</Text>
        </View>
      ) : (
        <>
          <ScrollView className="flex-1">
            <View className="gap-6 px-4 pb-4">
              {/* Group name */}
              <View className="gap-3">
                <Text className="px-1 text-xs font-medium uppercase tracking-wide text-muted">
                  Group name
                </Text>
                <View className="bg-surface rounded-xl p-4">
                  {editingName ? (
                    <View className="gap-2">
                      <Input
                        value={nameInput}
                        onChangeText={setNameInput}
                        autoFocus
                      />
                      <View className="flex-row justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onPress={() => setEditingName(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onPress={saveName}
                          isDisabled={rename.isPending || !nameInput.trim()}
                        >
                          Save
                        </Button>
                      </View>
                    </View>
                  ) : (
                    <Pressable
                      onPress={startEditingName}
                      className="flex-row items-center justify-between active:opacity-70"
                    >
                      <Text className="text-base">{group.name}</Text>
                      <Ionicons name="pencil" size={16} color="#888" />
                    </Pressable>
                  )}
                </View>
              </View>

              {/* Members */}
              <View className="gap-3">
                <View className="flex-row items-center justify-between px-1">
                  <Text className="text-xs font-medium uppercase tracking-wide text-muted">
                    Members ({group.members.length})
                  </Text>
                  <Pressable
                    onPress={() =>
                      navigation.navigate("GroupAddMembers", { groupId })
                    }
                    className="flex-row items-center gap-1 active:opacity-70"
                    accessibilityLabel="Add members"
                  >
                    <Ionicons
                      name="person-add-outline"
                      size={14}
                      color={iconColor}
                    />
                    <Text className="text-xs font-medium">Add</Text>
                  </Pressable>
                </View>
                <View className="bg-surface rounded-xl">
                  {group.members.map((member, index) => (
                    <View key={member.id}>
                      <View className="flex-row items-center gap-3 px-4 py-3">
                        <Avatar
                          userId={member.id}
                          image={member.image}
                          name={member.name}
                          size={36}
                        />
                        <Text className="text-sm">{member.name}</Text>
                      </View>
                      {index < group.members.length - 1 && (
                        <View className="bg-separator mx-4 h-px" />
                      )}
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Leave group */}
          <View className="px-4 py-3">
            <Dialog isOpen={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
              <Dialog.Trigger asChild>
                <Button variant="danger" isDisabled={leave.isPending}>
                  Leave group
                </Button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay />
                <Dialog.Content>
                  <Dialog.Title>Leave Group</Dialog.Title>
                  <Dialog.Description>
                    Are you sure you want to leave {group.name}? If you&apos;re
                    the last member, the group will be deleted.
                  </Dialog.Description>
                  <View className="flex-row justify-end gap-3 pt-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={() => setLeaveDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onPress={() => {
                        leave.mutate({ groupId });
                        setLeaveDialogOpen(false);
                      }}
                    >
                      Leave
                    </Button>
                  </View>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog>
          </View>
        </>
      )}
    </View>
  );
}
