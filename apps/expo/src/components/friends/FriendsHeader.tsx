import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Text } from "~/components/ui/text";

export function FriendsHeader({
  title = "Friends",
  showAddFriends,
  onToggleAddFriends,
}: {
  title?: string;
  showAddFriends: boolean;
  onToggleAddFriends: () => void;
}) {
  return (
    <View className="relative items-center px-4 py-3 pb-4">
      <Text className="text-lg font-semibold">{title}</Text>
      <Pressable
        onPress={onToggleAddFriends}
        className="absolute right-4 top-3 h-10 w-10 items-center justify-center rounded-full bg-secondary"
      >
        <Ionicons
          name={showAddFriends ? "close" : "person-add-outline"}
          size={20}
          color="#888"
        />
      </Pressable>
    </View>
  );
}
