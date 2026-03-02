import type { FriendRow, GroupRow } from "./types";

import type { ColorSchemeName, ImageSourcePropType } from "react-native";
import { FlatList, Pressable, RefreshControl, View } from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { GroupAvatar } from "~/components/ui/group-avatar";
import { Text } from "~/components/ui/text";
import { mediaKindColor } from "~/utils/media-kind";

import { FriendListRow } from "./FriendListRow";
import { getRelativeTime } from "./friendsTime";

function GroupListRow({
  group,
  onPress,
  onLongPress,
}: {
  group: GroupRow;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const color = mediaKindColor("photo");

  return (
    <Pressable
      className="min-h-[68px] flex-row items-center px-4"
      onPress={onPress}
      delayLongPress={300}
      onLongPress={onLongPress}
      android_ripple={{ color: "rgba(128,128,128,0.12)" }}
    >
      <GroupAvatar members={group.memberAvatars} size={44} />
      <View className="ml-3 flex-1 justify-center py-3">
        <View className="flex-row items-center justify-between">
          <Text className="flex-1 text-base" numberOfLines={1}>
            {group.name}
          </Text>
          {group.unreadCount > 0 && (
            <View className="ml-2 items-center justify-center rounded-full bg-primary px-2 py-0.5">
              <Text className="text-xs font-semibold tabular-nums text-primary-foreground">
                {group.unreadCount}
              </Text>
            </View>
          )}
        </View>
        <View className="mt-0.5 flex-row items-center gap-1.5">
          {group.unreadCount > 0 ? (
            <>
              <View
                className="size-2.5 rounded-[2px]"
                style={{ backgroundColor: color }}
              />
              <Text className="text-xs font-semibold" style={{ color }}>
                New Whisp
              </Text>
              {group.lastMessageAt && (
                <Text className="text-xs text-muted-foreground">
                  {"· "}
                  {getRelativeTime(group.lastMessageAt)}
                </Text>
              )}
            </>
          ) : group.lastSentByMe && group.lastMessageAt ? (
            <>
              <Ionicons name="arrow-redo" size={14} color={color} />
              <Text className="text-xs text-muted-foreground">Sent</Text>
              <Text className="text-xs text-muted-foreground">
                {"· "}
                {getRelativeTime(group.lastMessageAt)}
              </Text>
            </>
          ) : group.lastMessageAt ? (
            <>
              <View className="size-2.5 rounded-[2px] border-[1.5px] border-[#9ca3af]" />
              <Text className="text-xs text-muted-foreground">Received</Text>
              <Text className="text-xs text-muted-foreground">
                {"· "}
                {getRelativeTime(group.lastMessageAt)}
              </Text>
            </>
          ) : (
            <Text className="text-xs text-muted-foreground">
              {group.memberCount} member{group.memberCount !== 1 ? "s" : ""}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export function FriendsList({
  groupRows = [],
  rows,
  isRefreshing,
  onRefresh,
  whispLogo,
  colorScheme,
  onPressGroupRow,
  onLongPressGroupRow,
  onPressRow,
  onLongPressRow,
}: {
  groupRows?: GroupRow[];
  rows: FriendRow[];
  isRefreshing: boolean;
  onRefresh: () => void | Promise<void>;
  whispLogo: ImageSourcePropType;
  colorScheme: ColorSchemeName;
  onPressGroupRow?: (group: GroupRow) => void;
  onLongPressGroupRow?: (group: GroupRow) => void;
  onPressRow: (row: FriendRow) => void;
  onLongPressRow: (row: FriendRow) => void;
}) {
  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
      }
      ListHeaderComponent={
        groupRows.length > 0 && onPressGroupRow ? (
          <View className="mb-1">
            {groupRows.map((group) => (
              <GroupListRow
                key={group.id}
                group={group}
                onPress={() => onPressGroupRow(group)}
                onLongPress={
                  onLongPressGroupRow
                    ? () => onLongPressGroupRow(group)
                    : undefined
                }
              />
            ))}
            <View className="ml-[68px] h-px bg-border" />
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <FriendListRow
          item={item}
          whispLogo={whispLogo}
          colorScheme={colorScheme}
          onPress={() => onPressRow(item)}
          onLongPress={() => onLongPressRow(item)}
        />
      )}
      ItemSeparatorComponent={() => (
        <View className="ml-[68px] h-px bg-border" />
      )}
    />
  );
}
