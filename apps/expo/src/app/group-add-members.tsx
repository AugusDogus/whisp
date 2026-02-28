import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMemo, useState } from "react";
import { FlatList, Pressable, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import { toast } from "sonner-native";

import type { RootStackParamList } from "~/navigation/types";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";

export default function GroupAddMembersScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "GroupAddMembers">>();
  const { groupId } = route.params;
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const iconColor = colorScheme === "dark" ? "#fff" : "#000";

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const { data: group } = trpc.groups.get.useQuery({ groupId });
  const { data: friends = [], isLoading } = trpc.friends.list.useQuery();

  const memberIds = useMemo(
    () => new Set(group?.members.map((m) => m.id) ?? []),
    [group?.members],
  );
  const addableFriends = useMemo(() => {
    const base = friends.filter((f) => !memberIds.has(f.id));
    const q = searchQuery.trim().toLowerCase();
    if (q.length === 0) return base;
    return base.filter((f) => f.name.toLowerCase().includes(q));
  }, [friends, memberIds, searchQuery]);

  const utils = trpc.useUtils();
  const addMembers = trpc.groups.addMembers.useMutation({
    onSuccess: async () => {
      await utils.groups.get.invalidate({ groupId });
      await utils.groups.list.invalidate();
      navigation.goBack();
      toast.success("Members added");
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleFriend = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = () => {
    if (selectedIds.size === 0) {
      toast.error("Select at least one friend");
      return;
    }
    addMembers.mutate({ groupId, userIds: Array.from(selectedIds) });
  };

  const totalAddable = friends.filter((f) => !memberIds.has(f.id)).length;

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
        <View className="flex-1">
          <Text className="text-lg font-semibold">Add Members</Text>
          {group?.name && (
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              to {group.name}
            </Text>
          )}
        </View>
      </View>

      {/* Search */}
      {totalAddable > 0 && (
        <View className="px-4 pb-2">
          <Input
            placeholder="Search friends..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      )}

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted-foreground">Loading...</Text>
        </View>
      ) : totalAddable === 0 ? (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <View className="size-16 items-center justify-center rounded-full bg-muted">
            <Ionicons name="checkmark-circle-outline" size={32} color="#999" />
          </View>
          <Text className="text-center text-muted-foreground">
            All your friends are already in this group
          </Text>
          <Button variant="secondary" onPress={() => navigation.goBack()}>
            <Text>Go back</Text>
          </Button>
        </View>
      ) : addableFriends.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-muted-foreground">
            No friends match your search
          </Text>
        </View>
      ) : (
        <>
          <FlatList
            className="flex-1"
            data={addableFriends}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                className="flex-row items-center justify-between px-4"
                style={{ minHeight: 56 }}
                onPress={() => toggleFriend(item.id)}
                android_ripple={{ color: "rgba(128,128,128,0.12)" }}
              >
                <View className="flex-row items-center gap-3 py-2">
                  <Avatar
                    userId={item.id}
                    image={item.image}
                    name={item.name}
                    size={44}
                  />
                  <Text className="text-base">{item.name}</Text>
                </View>
                <View
                  className={
                    selectedIds.has(item.id)
                      ? "size-6 items-center justify-center rounded-full bg-primary"
                      : "size-6 rounded-full border-2 border-border"
                  }
                >
                  {selectedIds.has(item.id) && (
                    <Ionicons name="checkmark" size={14} color="#fff" />
                  )}
                </View>
              </Pressable>
            )}
            ItemSeparatorComponent={() => (
              <View className="ml-[68px] h-px bg-border" />
            )}
          />

          <View className="border-t border-border px-4 py-3">
            <Button
              onPress={handleAdd}
              disabled={selectedIds.size === 0 || addMembers.isPending}
            >
              <Text>
                {selectedIds.size > 0
                  ? `Add ${selectedIds.size} member${selectedIds.size !== 1 ? "s" : ""}`
                  : "Add members"}
              </Text>
            </Button>
          </View>
        </>
      )}
    </View>
  );
}
