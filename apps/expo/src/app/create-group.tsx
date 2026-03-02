import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useMemo, useState } from "react";
import { FlatList, Pressable, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { toast } from "sonner-native";

import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import type { RootStackParamList } from "~/navigation/types";
import { trpc } from "~/utils/api";

export default function CreateGroupScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const iconColor = colorScheme === "dark" ? "#fff" : "#000";

  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const { data: friends = [], isLoading } = trpc.friends.list.useQuery();
  const utils = trpc.useUtils();
  const createGroup = trpc.groups.create.useMutation({
    onSuccess: async (data) => {
      await utils.groups.list.invalidate();
      navigation.replace("Group", { groupId: data.groupId });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const filteredFriends = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length === 0) return friends;
    return friends.filter((f) => f.name.toLowerCase().includes(q));
  }, [friends, searchQuery]);

  const selectedFriends = useMemo(
    () => friends.filter((f) => selectedIds.has(f.id)),
    [friends, selectedIds],
  );

  const toggleFriend = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter a group name");
      return;
    }
    if (selectedIds.size === 0) {
      toast.error("Select at least one friend");
      return;
    }
    createGroup.mutate({
      name: trimmed,
      memberIds: Array.from(selectedIds),
    });
  };

  const canCreate = name.trim().length > 0 && selectedIds.size > 0;

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
        <Text className="flex-1 text-lg font-semibold">New Group</Text>
      </View>

      {/* Group name input */}
      <View className="px-4 pb-3">
        <Input
          placeholder="Group name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
      </View>

      {/* Selected friends summary */}
      {selectedFriends.length > 0 && (
        <View className="flex-row flex-wrap gap-2 px-4 pb-3">
          {selectedFriends.map((f) => (
            <Pressable
              key={f.id}
              onPress={() => toggleFriend(f.id)}
              className="flex-row items-center gap-1.5 rounded-full bg-primary/10 py-1 pl-1 pr-2.5"
            >
              <Avatar userId={f.id} image={f.image} name={f.name} size={22} />
              <Text className="text-xs font-medium" numberOfLines={1}>
                {f.name}
              </Text>
              <Ionicons name="close" size={14} color={iconColor} />
            </Pressable>
          ))}
        </View>
      )}

      {/* Search */}
      <View className="px-4 pb-2">
        <Input
          placeholder="Search friends..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Friend selection list */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted-foreground">Loading friends...</Text>
        </View>
      ) : filteredFriends.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-muted-foreground">
            {searchQuery.trim()
              ? "No friends match your search"
              : "Add some friends first to create a group"}
          </Text>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          data={filteredFriends}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              className="min-h-14 flex-row items-center justify-between px-4"
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
      )}

      {/* Create button */}
      <View className="border-t border-border px-4 py-3">
        <Button
          onPress={handleCreate}
          disabled={!canCreate || createGroup.isPending}
        >
          <Text>
            {selectedIds.size > 0
              ? `Create group (${selectedIds.size})`
              : "Create group"}
          </Text>
        </Button>
      </View>
    </View>
  );
}
