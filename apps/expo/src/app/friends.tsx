import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ResizeMode, Video } from "expo-av";
import { Image } from "expo-image";
import * as Notifications from "expo-notifications";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";

import type { MainTabParamList, RootStackParamList } from "~/navigation/types";
import { AddFriendsPanel } from "~/components/add-friends-panel";
import { FriendsListSkeletonVaried } from "~/components/friends-skeleton";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";
import { uploadMedia } from "~/utils/media-upload";

interface FriendRow {
  id: string;
  name: string;
  image: string | null;
  hasUnread: boolean;
  unreadCount: number;
  isSelected: boolean;
}

export default function FriendsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<MainTabParamList, "Friends">>();
  const mediaParams = route.params;
  const hasMedia = Boolean(mediaParams?.path);

  const {
    data: friends = [],
    refetch: refetchFriends,
    isLoading: friendsLoading,
  } = trpc.friends.list.useQuery();
  const {
    data: inbox = [],
    refetch: refetchInbox,
    isLoading: inboxLoading,
  } = trpc.messages.inbox.useQuery();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddFriends, setShowAddFriends] = useState(false);
  const utils = trpc.useUtils();
  const markRead = trpc.messages.markRead.useMutation({
    onSuccess: async () => {
      await utils.messages.inbox.invalidate();
    },
  });

  const onRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchFriends(), refetchInbox()]);
    setIsRefreshing(false);
  };

  const [viewer, setViewer] = useState<{
    friendId: string;
    queue: typeof inbox;
    index: number;
  } | null>(null);

  const openViewer = (friendId: string) => {
    const queue = inbox.filter((m) => m && m.senderId === friendId);
    if (queue.length === 0) return;

    // Optimistically update the inbox to remove messages from this friend
    utils.messages.inbox.setData(undefined, (old) =>
      old ? old.filter((m) => m && m.senderId !== friendId) : [],
    );

    // Clear notifications when opening viewer
    void Notifications.dismissAllNotificationsAsync();

    setViewer({ friendId, queue, index: 0 });
  };

  const closeViewer = () => {
    setViewer(null);
    // Clear any remaining notifications when closing viewer
    void Notifications.dismissAllNotificationsAsync();
  };

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
      isSelected:
        hasMedia && mediaParams?.defaultRecipientId
          ? f.id === mediaParams.defaultRecipientId
          : false,
    }));
  }, [friends, inbox, hasMedia, mediaParams?.defaultRecipientId]);

  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(
    new Set(
      hasMedia && mediaParams?.defaultRecipientId
        ? [mediaParams.defaultRecipientId]
        : [],
    ),
  );

  // Update selected friends when rows change (on initial load with defaultRecipientId)
  useEffect(() => {
    if (hasMedia && mediaParams?.defaultRecipientId) {
      setSelectedFriends(new Set([mediaParams.defaultRecipientId]));
    }
  }, [hasMedia, mediaParams?.defaultRecipientId]);

  // Handle deep link to open specific sender's messages
  useEffect(() => {
    if (
      mediaParams?.openMessageFromSender &&
      inbox.length > 0 &&
      !viewer // Only open if viewer is not already open
    ) {
      const senderId = mediaParams.openMessageFromSender;
      const hasMessagesFromSender = inbox.some((m) => m?.senderId === senderId);

      if (hasMessagesFromSender) {
        // Open the message viewer for this sender
        openViewer(senderId);

        // Clear the deep link param to prevent reopening on subsequent renders
        navigation.setParams({ openMessageFromSender: undefined });
      }
    }
    // openViewer is intentionally excluded from deps to avoid infinite loop:
    // openViewer modifies inbox state, which would cause it to be redefined,
    // triggering this effect again. We only want this to run when the deep
    // link parameter changes, not when openViewer's reference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaParams?.openMessageFromSender, inbox, viewer, navigation]);

  function toggleFriend(id: string) {
    setSelectedFriends((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length === 0) return rows;
    return rows.filter((f) => f.name.toLowerCase().includes(q));
  }, [rows, searchQuery]);

  const mediaSource = useMemo(
    () => (mediaParams?.path ? { uri: `file://${mediaParams.path}` } : null),
    [mediaParams?.path],
  );

  const numSelected = selectedFriends.size;

  const isLoading = friendsLoading || inboxLoading;

  // Send mode: Show media preview, search, and send button
  if (hasMedia && mediaSource) {
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

          {isLoading ? (
            <View className="mt-4">
              <FriendsListSkeletonVaried />
            </View>
          ) : (
            <FlatList
              className="mt-4"
              data={filteredRows}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  className="flex-row items-center justify-between px-4 py-4"
                  onPress={() => toggleFriend(item.id)}
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
                  <View
                    className={
                      selectedFriends.has(item.id)
                        ? "h-6 w-6 items-center justify-center rounded-full bg-primary"
                        : "h-6 w-6 rounded-full border border-border"
                    }
                  />
                </Pressable>
              )}
              ItemSeparatorComponent={() => <View className="h-px bg-border" />}
            />
          )}

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
                // mediaSource is guaranteed non-null in this block (line 197 condition)
                // mediaParams.type must exist if we're in send mode
                if (mediaParams?.type) {
                  void uploadMedia({
                    uri: mediaSource.uri,
                    type: mediaParams.type,
                    recipients: Array.from(selectedFriends),
                  });
                  // Navigate immediately, don't wait for upload
                  navigation.reset({ index: 0, routes: [{ name: "Main" }] });
                }
              }}
            >
              <Text>{numSelected > 0 ? `Send (${numSelected})` : "Send"}</Text>
            </Button>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Normal mode: Show friends list with inbox counts
  return (
    <>
      <SafeAreaView className="bg-background">
        <View className="h-full w-full">
          <View className="relative items-center px-4 py-3 pb-4">
            <Text className="text-lg font-semibold">Friends</Text>
            <Pressable
              onPress={() => setShowAddFriends(!showAddFriends)}
              className="absolute right-4 top-3 h-10 w-10 items-center justify-center rounded-full bg-secondary"
            >
              <Ionicons
                name={showAddFriends ? "close" : "person-add-outline"}
                size={20}
                color="#888"
              />
            </Pressable>
          </View>

          {isLoading ? (
            <FriendsListSkeletonVaried />
          ) : showAddFriends ? (
            <View className="flex-1 px-4 pt-2">
              <AddFriendsPanel />
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(item) => item.id}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={onRefresh}
                />
              }
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
          )}
        </View>
      </SafeAreaView>

      {/* Message viewer modal - outside SafeAreaView to avoid safe area padding */}
      <Modal visible={Boolean(viewer)} transparent={false} animationType="fade">
        <TouchableWithoutFeedback onPress={onViewerTap}>
          <View className="flex-1 bg-black">
            {viewer?.queue[viewer.index]
              ? (() => {
                  const m = viewer.queue[viewer.index];
                  if (!m) return null;
                  const isVideo = (m.mimeType ?? "").startsWith("video/");
                  return isVideo ? (
                    <Video
                      source={{ uri: m.fileUrl }}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode={ResizeMode.COVER}
                      shouldPlay
                      isLooping={false}
                      useNativeControls={false}
                    />
                  ) : (
                    <Image
                      source={{ uri: m.fileUrl }}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="cover"
                    />
                  );
                })()
              : null}
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
}
