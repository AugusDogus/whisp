import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useNavigation, useRoute } from "@react-navigation/native";
import { toast } from "sonner-native";

import type { RootStackParamList } from "~/navigation/types";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { createFile, useUploadThing } from "~/utils/uploadthing";

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
  const { path } = route.params;

  const [friends, setFriends] = useState<FriendItem[]>(() =>
    MOCK_FRIENDS.map((f) => ({ ...f, isSelected: false })),
  );
  const [searchQuery, setSearchQuery] = useState("");

  const mediaSource = useMemo(() => ({ uri: `file://${path}` }), [path]);
  const numSelected = useMemo(
    () => friends.filter((f) => f.isSelected).length,
    [friends],
  );

  const filteredFriends = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length === 0) return friends;
    return friends.filter((f) => f.name.toLowerCase().includes(q));
  }, [friends, searchQuery]);

  function toggleFriend(id: string) {
    setFriends((prev) =>
      prev.map((f) => (f.id === id ? { ...f, isSelected: !f.isSelected } : f)),
    );
  }

  const { startUpload } = useUploadThing("imageUploader", {
    /**
     * Any props here are forwarded to the underlying `useUploadThing` hook.
     * Refer to the React API reference for more info.
     */
    onClientUploadComplete: () => void toast.success("whisper sent"),
    onUploadError: (error) => void toast.error(error.message),
  });

  return (
    <SafeAreaView className="bg-background">
      <View className="h-full w-full">
        <View className="flex w-full flex-row items-center gap-4 px-4">
          <View className="h-16 w-16 overflow-hidden rounded-md bg-secondary">
            <Image
              source={mediaSource}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
            />
          </View>
          <Input
            placeholder="Send to…"
            className="w-auto flex-1"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        <FlatList
          className="mt-4"
          data={filteredFriends}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              className="flex-row items-center justify-between px-4 py-4"
              onPress={() => toggleFriend(item.id)}
            >
              <View className="flex-row items-center gap-3">
                <View className="h-10 w-10 items-center justify-center rounded-full bg-secondary">
                  <Text className="text-base font-semibold">
                    {item.name.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <Text className="text-base">{item.name}</Text>
              </View>
              <View
                className={
                  item.isSelected
                    ? "h-6 w-6 items-center justify-center rounded-full bg-primary"
                    : "h-6 w-6 rounded-full border border-border"
                }
              />
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View className="h-px bg-border" />}
        />

        <View className="flex flex-row gap-2 px-4 py-3">
          <Button
            variant="secondary"
            className="w-1/2"
            onPress={() => navigation.goBack()}
          >
            <Text>Back</Text>
          </Button>
          <Button
            className="w-1/2"
            disabled={numSelected === 0}
            onPress={() => {
              const file = createFile(mediaSource.uri);
              void startUpload([file]);
              // After send, reset stack to prevent navigating back
              navigation.reset({ index: 0, routes: [{ name: "Camera" }] });
            }}
          >
            <Text>{numSelected > 0 ? `Send (${numSelected})` : "Send"}</Text>
          </Button>
        </View>
      </View>
    </SafeAreaView>
  );
}
