import {
  ActivityIndicator,
  Pressable,
  useColorScheme,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { Text } from "~/components/ui/text";

export function FriendsHeader({
  title = "Friends",
  showAddFriends,
  onToggleAddFriends,
  onNewGroup,
  onRefresh,
  isRefreshing,
}: {
  title?: string;
  showAddFriends: boolean;
  onToggleAddFriends: () => void;
  onNewGroup?: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const colorScheme = useColorScheme();
  const iconColor = colorScheme === "dark" ? "#ccc" : "#555";

  return (
    <View className="relative items-center px-4 py-3 pb-4">
      <Pressable
        onPress={onRefresh}
        disabled={isRefreshing}
        accessibilityRole="button"
        accessibilityLabel="Refresh friends"
        accessibilityState={{ disabled: isRefreshing, busy: isRefreshing }}
        className="bg-default absolute left-4 top-3 size-10 items-center justify-center rounded-full"
      >
        {isRefreshing ? (
          <ActivityIndicator color={iconColor} />
        ) : (
          <Ionicons name="refresh-outline" size={20} color={iconColor} />
        )}
      </Pressable>
      <Text className="text-lg font-semibold">{title}</Text>
      <View className="absolute right-4 top-3 flex-row gap-2">
        {onNewGroup && (
          <Pressable
            onPress={onNewGroup}
            className="bg-default size-10 items-center justify-center rounded-full"
            accessibilityLabel="Create new group"
          >
            <Ionicons name="people-outline" size={20} color={iconColor} />
          </Pressable>
        )}
        <Pressable
          onPress={onToggleAddFriends}
          className="bg-default size-10 items-center justify-center rounded-full"
          accessibilityLabel={
            showAddFriends ? "Close add friends" : "Add friends"
          }
        >
          <Ionicons
            name={showAddFriends ? "close" : "person-add-outline"}
            size={20}
            color={iconColor}
          />
        </Pressable>
      </View>
    </View>
  );
}
