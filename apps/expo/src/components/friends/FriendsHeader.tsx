import { Pressable, View, useColorScheme } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Text } from "~/components/ui/text";

export function FriendsHeader({
  title = "Friends",
  showAddFriends,
  onToggleAddFriends,
  onNewGroup,
}: {
  title?: string;
  showAddFriends: boolean;
  onToggleAddFriends: () => void;
  onNewGroup?: () => void;
}) {
  const colorScheme = useColorScheme();
  const iconColor = colorScheme === "dark" ? "#ccc" : "#555";

  return (
    <View className="relative items-center px-4 py-3 pb-4">
      <Text className="text-lg font-semibold">{title}</Text>
      <View className="absolute right-4 top-3 flex-row gap-2">
        {onNewGroup && (
          <Pressable
            onPress={onNewGroup}
            className="size-10 items-center justify-center rounded-full bg-secondary"
            accessibilityLabel="Create new group"
          >
            <Ionicons name="people-outline" size={20} color={iconColor} />
          </Pressable>
        )}
        <Pressable
          onPress={onToggleAddFriends}
          className="size-10 items-center justify-center rounded-full bg-secondary"
          accessibilityLabel={showAddFriends ? "Close add friends" : "Add friends"}
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
