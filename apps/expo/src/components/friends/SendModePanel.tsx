import type { ComponentProps } from "react";
import type { EdgeInsets } from "react-native-safe-area-context";
import { FlatList, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import type { FriendRow } from "./types";
import { FriendsListSkeletonVaried } from "~/components/friends-skeleton";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
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

  // If we're still rasterizing but we know captions exist, show the thumbhash.
  if (captionsCount > 0) {
    return thumbhash ? { thumbhash } : undefined;
  }

  if (mediaPath) return { uri: `file://${mediaPath}` };
  return undefined;
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
  rows,
  selectedFriends,
  toggleFriend,
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
  rows: FriendRow[];
  selectedFriends: Set<string>;
  toggleFriend: (id: string) => void;
  onBack: () => void;
  onSend: (recipients: string[]) => void | Promise<void>;
}) {
  const numSelected = selectedFriends.size;
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
        <View
          className="flex w-full flex-row items-center gap-4 px-4 py-4"
          style={{ flexShrink: 0 }}
        >
          <View className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-secondary">
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

        {isLoading ? (
          <View className="mt-4">
            <FriendsListSkeletonVaried />
          </View>
        ) : (
          <FlatList
            className="flex-1"
            data={rows}
            keyExtractor={(item) => item.id}
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
                    selectedFriends.has(item.id)
                      ? "size-6 items-center justify-center rounded-full bg-primary"
                      : "size-6 rounded-full border-2 border-border"
                  }
                >
                  {selectedFriends.has(item.id) && (
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

        <View className="flex flex-row gap-2 px-4 py-3">
          <Button variant="secondary" className="w-1/2" onPress={onBack}>
            <Text>Back</Text>
          </Button>
          <Button
            className="w-1/2"
            disabled={numSelected === 0}
            onPress={() => {
              const recipients = Array.from(selectedFriends);
              void onSend(recipients);
            }}
          >
            <Text>{numSelected > 0 ? `Send (${numSelected})` : "Send"}</Text>
          </Button>
        </View>
      </View>
    </View>
  );
}
