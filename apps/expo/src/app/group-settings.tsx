import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useState } from "react";
import { Pressable, ScrollView, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import { toast } from "sonner-native";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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

  const { data: group, isLoading } = trpc.groups.get.useQuery(
    { groupId },
    { enabled: !!groupId },
  );

  const utils = trpc.useUtils();
  const rename = trpc.groups.rename.useMutation({
    onSuccess: async () => {
      await utils.groups.get.invalidate({ groupId });
      await utils.groups.list.invalidate();
      setEditingName(false);
      toast.success("Group renamed");
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
          <Text className="text-muted-foreground">Loading...</Text>
        </View>
      ) : !group ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted-foreground">Group not found</Text>
        </View>
      ) : (
        <>
          <ScrollView className="flex-1">
            <View className="gap-3 px-4 pb-4">
              {/* Group name card */}
              <View className="rounded-lg border border-border bg-background p-4 shadow-sm shadow-black/5">
                <View className="flex-row items-center gap-3 pb-3">
                  <View className="size-10 items-center justify-center rounded-full bg-primary/10">
                    <Ionicons name="text" size={20} color="#666" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-semibold">Group name</Text>
                    <Text variant="muted" className="text-xs">
                      Visible to all members
                    </Text>
                  </View>
                </View>
                {editingName ? (
                  <View className="gap-2 pt-1">
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
                        <Text>Cancel</Text>
                      </Button>
                      <Button
                        size="sm"
                        onPress={saveName}
                        disabled={rename.isPending || !nameInput.trim()}
                      >
                        <Text>Save</Text>
                      </Button>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={startEditingName}
                    className="flex-row items-center justify-between rounded-md bg-secondary/50 px-3 py-2.5"
                  >
                    <Text className="text-base">{group.name}</Text>
                    <Ionicons name="pencil" size={16} color="#888" />
                  </Pressable>
                )}
              </View>

              {/* Members card */}
              <View className="rounded-lg border border-border bg-background p-4 shadow-sm shadow-black/5">
                <View className="flex-row items-center gap-3 pb-3">
                  <View className="size-10 items-center justify-center rounded-full bg-primary/10">
                    <Ionicons name="people" size={20} color="#666" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-semibold">
                      Members ({group.members.length})
                    </Text>
                    <Text variant="muted" className="text-xs">
                      Anyone can add friends
                    </Text>
                  </View>
                </View>
                <View className="gap-0.5">
                  {group.members.map((member, index) => (
                    <View key={member.id}>
                      <View className="flex-row items-center gap-3 py-2">
                        <Avatar
                          userId={member.id}
                          image={member.image}
                          name={member.name}
                          size={36}
                        />
                        <Text className="text-sm">{member.name}</Text>
                      </View>
                      {index < group.members.length - 1 && (
                        <View className="ml-12 h-px bg-border" />
                      )}
                    </View>
                  ))}
                </View>
                <Button
                  variant="outline"
                  className="mt-3"
                  onPress={() =>
                    navigation.navigate("GroupAddMembers", { groupId })
                  }
                >
                  <Text>Add members</Text>
                </Button>
              </View>
            </View>
          </ScrollView>

          {/* Leave group button - fixed at bottom */}
          <View className="border-t border-border px-4 py-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={leave.isPending}>
                  <Text>Leave group</Text>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Leave Group</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to leave {group.name}? If you&apos;re
                    the last member, the group will be deleted.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    <Text>Cancel</Text>
                  </AlertDialogCancel>
                  <AlertDialogAction onPress={() => leave.mutate({ groupId })}>
                    <Text>Leave</Text>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </View>
        </>
      )}
    </View>
  );
}
