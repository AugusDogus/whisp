import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TextInput } from "react-native";
import { FlatList, Pressable, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";
import { Input } from "heroui-native/input";
import { toast } from "sonner-native";

import { Avatar } from "~/components/ui/avatar";
import { Text } from "~/components/ui/text";
import type { RootStackParamList } from "~/navigation/types";
import { trpc } from "~/utils/api";

export default function CreateGroupScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const iconColor = colorScheme === "dark" ? "#fff" : "#000";

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const nameInputRef = useRef<TextInput>(null);

  const { data: friends = [], isLoading } = trpc.friends.list.useQuery();
  const utils = trpc.useUtils();
  const createGroup = trpc.groups.create.useMutation({
    onSuccess: (data) => {
      navigation.replace("Group", { groupId: data.groupId });
      void utils.groups.list.invalidate();
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

  const handleNext = () => {
    setName("");
    setNameDialogOpen(true);
  };

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter a group name");
      return;
    }
    setNameDialogOpen(false);
    createGroup.mutate({
      name: trimmed,
      memberIds: Array.from(selectedIds),
    });
  };

  useEffect(() => {
    if (nameDialogOpen) {
      const timeout = setTimeout(() => nameInputRef.current?.focus(), 350);
      return () => clearTimeout(timeout);
    }
  }, [nameDialogOpen]);

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

      {/* Selected chips */}
      {selectedFriends.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5 px-4 pb-2">
          {selectedFriends.map((f) => (
            <Pressable
              key={f.id}
              onPress={() => toggleFriend(f.id)}
              className="bg-default flex-row items-center gap-1.5 rounded-full py-1 pl-1 pr-2"
            >
              <Avatar userId={f.id} image={f.image} name={f.name} size={20} />
              <Text className="text-xs" numberOfLines={1}>
                {f.name}
              </Text>
              <Ionicons name="close" size={12} color={iconColor} />
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

      {/* Friend list */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted">Loading friends...</Text>
        </View>
      ) : filteredFriends.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-muted">
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
          renderItem={({ item }) => {
            const selected = selectedIds.has(item.id);
            return (
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
                    selected
                      ? "size-6 items-center justify-center rounded-full bg-foreground"
                      : "border-separator size-6 rounded-full border-2"
                  }
                >
                  {selected && (
                    <Ionicons
                      name="checkmark"
                      size={14}
                      color={colorScheme === "dark" ? "#000" : "#fff"}
                    />
                  )}
                </View>
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => (
            <View className="bg-separator ml-[68px] h-px" />
          )}
        />
      )}

      {/* Bottom bar */}
      <View className="px-4 py-3">
        <Button
          onPress={handleNext}
          isDisabled={selectedIds.size === 0 || createGroup.isPending}
        >
          {selectedIds.size > 0
            ? `Next (${selectedIds.size} selected)`
            : "Select friends"}
        </Button>
      </View>

      {/* Name dialog */}
      <Dialog isOpen={nameDialogOpen} onOpenChange={setNameDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Name your group</Dialog.Title>
            <Dialog.Description>
              Choose a name for your group with{" "}
              {selectedIds.size === 1
                ? "1 member"
                : `${selectedIds.size} members`}
              .
            </Dialog.Description>
            <View className="pt-4">
              <Input
                ref={nameInputRef}
                placeholder="Group name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                onSubmitEditing={handleCreate}
                returnKeyType="done"
              />
            </View>
            <View className="flex-row justify-end gap-3 pt-4">
              <Button
                variant="ghost"
                size="sm"
                onPress={() => setNameDialogOpen(false)}
              >
                Back
              </Button>
              <Button
                size="sm"
                onPress={handleCreate}
                isDisabled={!name.trim() || createGroup.isPending}
              >
                Create
              </Button>
            </View>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </View>
  );
}
