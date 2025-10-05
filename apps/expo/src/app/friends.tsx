import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useNavigation, useRoute } from "@react-navigation/native";

import type { RootStackParamList } from "~/navigation/types";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";

interface FriendItem {
  id: string;
  name: string;
  isSelected: boolean;
}

const MOCK_FRIENDS: Omit<FriendItem, "isSelected">[] = [
  { id: "1", name: "Alex" },
  { id: "2", name: "Bailey" },
  { id: "3", name: "Casey" },
  { id: "4", name: "Devon" },
  { id: "5", name: "Emery" },
  { id: "6", name: "Frankie" },
  { id: "7", name: "Harper" },
];

export default function FriendsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "Friends">>();
  const { path, type } = route.params;

  const [friends, setFriends] = useState<FriendItem[]>(() =>
    MOCK_FRIENDS.map((f) => ({ ...f, isSelected: false })),
  );

  const mediaSource = useMemo(() => ({ uri: `file://${path}` }), [path]);
  const numSelected = useMemo(
    () => friends.filter((f) => f.isSelected).length,
    [friends],
  );

  function toggleFriend(id: string) {
    setFriends((prev) =>
      prev.map((f) => (f.id === id ? { ...f, isSelected: !f.isSelected } : f)),
    );
  }

  return (
    <SafeAreaView className="bg-background">
      <View className="h-full w-full">
        <View className="w-full flex-row items-center justify-between px-4 py-3">
          <Text className="text-lg font-semibold">Send to</Text>
          <Button
            disabled={numSelected === 0}
            onPress={() => {
              // After send, reset stack to prevent navigating back
              navigation.reset({ index: 0, routes: [{ name: "Camera" }] });
            }}
          >
            <Text>{numSelected > 0 ? `Send (${numSelected})` : "Send"}</Text>
          </Button>
        </View>

        <View className="flex-row gap-3 px-4">
          <View className="h-16 w-16 overflow-hidden rounded-md bg-secondary">
            <Image
              source={mediaSource}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
            />
          </View>
          <View className="flex-1 justify-center">
            <Text className="text-sm" variant="muted">
              {type === "photo" ? "Photo" : "Video"} ready to send
            </Text>
          </View>
        </View>

        <FlatList
          className="mt-4"
          data={friends}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              className="flex-row items-center justify-between px-4 py-3"
              onPress={() => toggleFriend(item.id)}
            >
              <Text className="text-base">{item.name}</Text>
              <View
                className={
                  item.isSelected
                    ? "h-5 w-5 items-center justify-center rounded-full bg-primary"
                    : "h-5 w-5 rounded-full border border-border"
                }
              />
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View className="h-px bg-border" />}
        />

        <View className="px-4 py-3">
          <Button variant="secondary" onPress={() => navigation.goBack()}>
            <Text>Back</Text>
          </Button>
        </View>
      </View>
    </SafeAreaView>
  );
}
