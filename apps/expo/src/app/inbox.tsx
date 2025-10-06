import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ResizeMode, Video } from "expo-av";
import { Image } from "expo-image";
import { useNavigation } from "@react-navigation/native";

import type { RootStackParamList } from "~/navigation/types";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";

interface FriendRow {
  id: string;
  name: string;
  image: string | null;
  hasUnread: boolean;
  unreadCount: number;
}

export default function InboxScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: friends = [] } = trpc.friends.list.useQuery();
  const { data: inbox = [] } = trpc.messages.inbox.useQuery();
  const utils = trpc.useUtils();
  const markRead = trpc.messages.markRead.useMutation({
    onSuccess: async () => {
      await utils.messages.inbox.invalidate();
    },
  });

  const [viewer, setViewer] = useState<{
    friendId: string;
    queue: typeof inbox;
    index: number;
  } | null>(null);

  const openViewer = (friendId: string) => {
    const queue = inbox.filter((m) => m && m.senderId === friendId);
    if (queue.length === 0) return;
    setViewer({ friendId, queue, index: 0 });
  };

  const closeViewer = () => setViewer(null);

  const onViewerTap = () => {
    if (!viewer) return;
    const current = viewer.queue[viewer.index];
    if (current) {
      markRead.mutate({ deliveryId: current.deliveryId });
    }
    const nextIndex = viewer.index + 1;
    if (nextIndex < viewer.queue.length)
      setViewer({ ...viewer, index: nextIndex });
    else closeViewer();
  };

  const rows = useMemo<FriendRow[]>(() => {
    const senderToMessages = new Map<string, number>();
    for (const m of inbox) {
      if (!m) continue;
      const count = senderToMessages.get(m.senderId) ?? 0;
      senderToMessages.set(m.senderId, count + 1);
    }
    return friends.map((f) => ({
      id: f.id,
      name: f.name,
      image: (f as unknown as { image?: string | null }).image ?? null,
      hasUnread: (senderToMessages.get(f.id) ?? 0) > 0,
      unreadCount: senderToMessages.get(f.id) ?? 0,
    }));
  }, [friends, inbox]);

  return (
    <SafeAreaView className="bg-background">
      <View className="h-full w-full">
        <View className="items-center px-4 py-3">
          <Text className="text-lg font-semibold">Inbox</Text>
        </View>

        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              className="flex-row items-center justify-between px-4 py-4"
              onPress={() => {
                if (item.unreadCount > 0) openViewer(item.id);
                else {
                  navigation.navigate("Camera", {
                    defaultRecipientId: item.id,
                  });
                }
              }}
            >
              <View className="flex-row items-center gap-3">
                <View className="h-10 w-10 overflow-hidden rounded-full bg-secondary">
                  {item.image ? (
                    <Image
                      source={{ uri: item.image }}
                      style={{ width: 40, height: 40 }}
                      contentFit="cover"
                    />
                  ) : (
                    <View className="h-full w-full items-center justify-center">
                      <Text className="text-base font-semibold">
                        {(() => {
                          const n = item.name.trim();
                          if (n.length === 0) return "?";
                          const cp = n.codePointAt(0);
                          if (cp == null) return "?";
                          const first = String.fromCodePoint(cp);
                          return /^[a-z]$/i.test(first)
                            ? first.toUpperCase()
                            : first;
                        })()}
                      </Text>
                    </View>
                  )}
                </View>
                <Text className="text-base">{item.name}</Text>
              </View>
              {item.hasUnread ? (
                <View className="items-center justify-center rounded-full bg-primary px-2 py-1">
                  <Text className="text-xs font-semibold text-primary-foreground">
                    {item.unreadCount}
                  </Text>
                </View>
              ) : (
                <View className="h-3 w-3 rounded-full bg-muted" />
              )}
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View className="h-px bg-border" />}
        />
      </View>

      <Modal visible={Boolean(viewer)} transparent animationType="fade">
        <TouchableWithoutFeedback onPress={onViewerTap}>
          <View className="flex-1 items-center justify-center bg-black/90">
            {viewer?.queue[viewer.index]
              ? (() => {
                  const m = viewer.queue[viewer.index];
                  if (!m) return null;
                  const isVideo = (m.mimeType ?? "").startsWith("video/");
                  return isVideo ? (
                    <Video
                      source={{ uri: m.fileUrl }}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode={ResizeMode.CONTAIN}
                      shouldPlay
                      isLooping={false}
                      useNativeControls={false}
                    />
                  ) : (
                    <Image
                      source={{ uri: m.fileUrl }}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="contain"
                    />
                  );
                })()
              : null}
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  );
}
