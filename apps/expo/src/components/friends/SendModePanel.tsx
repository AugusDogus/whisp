import type { ComponentProps } from "react";
import type { EdgeInsets } from "react-native-safe-area-context";
import { FlatList, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import type { FriendRow, GroupRow } from "./types";
import { FriendsListSkeletonVaried } from "~/components/friends-skeleton";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { GroupAvatar } from "~/components/ui/group-avatar";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";

type PreviewSource = ComponentProps<typeof Image>["source"];

function buildPreviewSource({
  rasterizedImagePath,
  captionsCount,
  thumbhash,
  mediaPath,
}: {
  rasterizedImagePath: string | null;
  captionsCount: number;
  thumbhash: string | undefined;
  mediaPath: string | null;
}): PreviewSource | undefined {
  if (rasterizedImagePath) return { uri: `file://${rasterizedImagePath}` };

  if (captionsCount > 0) {
    return thumbhash ? { thumbhash } : undefined;
  }

  if (mediaPath) return { uri: `file://${mediaPath}` };
  return undefined;
}

function GroupRowItem({
  group,
  isSelected,
  onPress,
}: {
  group: GroupRow;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      className="flex-row items-center justify-between px-4"
      style={{ minHeight: 68 }}
      onPress={onPress}
      android_ripple={{ color: "rgba(128,128,128,0.12)" }}
    >
      <View className="flex-row items-center gap-3 py-2">
        <GroupAvatar members={group.memberAvatars} size={44} />
        <View>
          <Text className="text-base">{group.name}</Text>
          <Text className="text-xs text-muted-foreground">
            {group.memberCount} member{group.memberCount !== 1 ? "s" : ""}
          </Text>
        </View>
      </View>
      <View
        className={
          isSelected
            ? "size-6 items-center justify-center rounded-full bg-primary"
            : "size-6 rounded-full border-2 border-border"
        }
      >
        {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
      </View>
    </Pressable>
  );
}

function FriendRowItem({
  friend,
  isSelected,
  onPress,
}: {
  friend: FriendRow;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      className="flex-row items-center justify-between px-4"
      style={{ minHeight: 68 }}
      onPress={onPress}
      android_ripple={{ color: "rgba(128,128,128,0.12)" }}
    >
      <View className="flex-row items-center gap-3 py-2">
        <Avatar
          userId={friend.id}
          image={friend.image}
          name={friend.name}
          size={44}
        />
        <Text className="text-base">{friend.name}</Text>
      </View>
      <View
        className={
          isSelected
            ? "size-6 items-center justify-center rounded-full bg-primary"
            : "size-6 rounded-full border-2 border-border"
        }
      >
        {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
      </View>
    </Pressable>
  );
}

export function SendModePanel({
  insets,
  mediaPath,
  rasterizedImagePath,
  captionsCount,
  thumbhash,
  searchQuery,
  onChangeSearchQuery,
  isLoading,
  groupRows,
  rows,
  selectedFriends,
  selectedGroupId,
  toggleFriend,
  toggleGroup,
  onBack,
  onSend,
}: {
  insets: EdgeInsets;
  mediaPath: string | null;
  rasterizedImagePath: string | null;
  captionsCount: number;
  thumbhash: string | undefined;
  searchQuery: string;
  onChangeSearchQuery: (next: string) => void;
  isLoading: boolean;
  groupRows: GroupRow[];
  rows: FriendRow[];
  selectedFriends: Set<string>;
  selectedGroupId: string | null;
  toggleFriend: (id: string) => void;
  toggleGroup: (groupId: string) => void;
  onBack: () => void;
  onSend: (opts: {
    recipients?: string[];
    groupId?: string;
  }) => void | Promise<void>;
}) {
  const hasGroupSelected = selectedGroupId !== null;
  const numFriendsSelected = selectedFriends.size;
  const canSend = hasGroupSelected || numFriendsSelected > 0;
  const previewSource = buildPreviewSource({
    rasterizedImagePath,
    captionsCount,
    thumbhash,
    mediaPath,
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
      <View className="flex-1" style={{ minHeight: 0 }}>
        {/* Preview + search */}
        <View
          className="flex w-full flex-row items-center gap-4 px-4 py-4"
          style={{ flexShrink: 0 }}
        >
          <View className="size-16 flex-shrink-0 overflow-hidden rounded-md bg-secondary">
            <Image
              source={previewSource}
              style={{ width: 64, height: 64 }}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={200}
            />
          </View>
          <Input
            placeholder="Send to..."
            className="w-auto flex-1"
            value={searchQuery}
            onChangeText={onChangeSearchQuery}
          />
        </View>

        {/* Recipient list */}
        {isLoading ? (
          <View className="mt-4">
            <FriendsListSkeletonVaried />
          </View>
        ) : (
          <FlatList
            className="flex-1"
            data={rows}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            extraData={{ selectedGroupId, selectedFriends }}
            ListHeaderComponent={
              groupRows.length > 0 ? (
                <View className="mb-1">
                  {groupRows.map((group) => (
                    <GroupRowItem
                      key={group.id}
                      group={group}
                      isSelected={selectedGroupId === group.id}
                      onPress={() => toggleGroup(group.id)}
                    />
                  ))}
                  <View className="ml-[68px] h-px bg-border" />
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <FriendRowItem
                friend={item}
                isSelected={selectedFriends.has(item.id)}
                onPress={() => toggleFriend(item.id)}
              />
            )}
            ItemSeparatorComponent={() => (
              <View className="ml-[68px] h-px bg-border" />
            )}
          />
        )}

        {/* Action buttons */}
        <View className="flex flex-row gap-2 border-t border-border px-4 py-3">
          <Button variant="secondary" className="flex-1" onPress={onBack}>
            <Text>Back</Text>
          </Button>
          <Button
            className="flex-1"
            disabled={!canSend}
            onPress={() => {
              if (hasGroupSelected && selectedGroupId) {
                void onSend({ groupId: selectedGroupId });
              } else {
                void onSend({ recipients: Array.from(selectedFriends) });
              }
            }}
          >
            <Text>
              {hasGroupSelected
                ? "Send to group"
                : numFriendsSelected > 0
                  ? `Send (${numFriendsSelected})`
                  : "Send"}
            </Text>
          </Button>
        </View>
      </View>
    </View>
  );
}
