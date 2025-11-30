import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Video as VideoType } from "expo-av";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  TouchableWithoutFeedback,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ResizeMode, Video } from "expo-av";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as Notifications from "expo-notifications";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { useNavigation, useRoute } from "@react-navigation/native";

import type { MainTabParamList, RootStackParamList } from "~/navigation/types";
import { AddFriendsPanel } from "~/components/add-friends-panel";
import { FriendsListSkeletonVaried } from "~/components/friends-skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { useRecording } from "~/contexts/RecordingContext";
import { trpc } from "~/utils/api";
import { uploadMedia } from "~/utils/media-upload";
import WhispLogoDark from "../../assets/splash-icon-dark.png";
import WhispLogoLight from "../../assets/splash-icon.png";

interface FriendRow {
  id: string;
  name: string;
  image: string | null;
  discordId: string | null;
  hasUnread: boolean;
  unreadCount: number;
  isSelected: boolean;
  streak: number;
  lastActivityTimestamp: Date | null;
  partnerLastActivityTimestamp: Date | null;
  hoursRemaining: number | null;
}

export default function FriendsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<MainTabParamList, "Friends">>();
  const mediaParams = route.params;
  const hasMedia = Boolean(mediaParams?.path);
  const insets = useSafeAreaInsets();
  const { setIsSendMode } = useRecording();
  const colorScheme = useColorScheme();

  // Select the appropriate logo based on color scheme
  const whispLogo = colorScheme === "dark" ? WhispLogoDark : WhispLogoLight;

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
  const [selectedFriend, setSelectedFriend] = useState<FriendRow | null>(null);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const isShowingDialogRef = useRef(false);
  const videoRef = useRef<VideoType>(null);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const utils = trpc.useUtils();
  const markRead = trpc.messages.markRead.useMutation({
    onMutate: async (variables) => {
      // Cancel any outgoing refetches
      await utils.messages.inbox.cancel();

      // Snapshot the previous value
      const previousInbox = utils.messages.inbox.getData();

      // Optimistically remove the message from inbox
      utils.messages.inbox.setData(undefined, (old) => {
        if (!old) return old;
        return old.filter((msg) => msg?.deliveryId !== variables.deliveryId);
      });

      // Return context with the snapshot
      return { previousInbox };
    },
    onError: (err, variables, context) => {
      // If the mutation fails, roll back to the previous value
      if (context?.previousInbox) {
        utils.messages.inbox.setData(undefined, context.previousInbox);
      }
    },
    onSettled: async () => {
      // Always refetch after error or success to ensure we're in sync
      await utils.messages.inbox.invalidate();
    },
  });

  const removeFriend = trpc.friends.removeFriend.useMutation({
    onMutate: async (variables) => {
      // Cancel any outgoing refetches
      await utils.friends.list.cancel();

      // Snapshot the previous value
      const previousFriends = utils.friends.list.getData();

      // Optimistically update to remove the friend
      utils.friends.list.setData(undefined, (old) => {
        if (!old) return old;
        return old.filter((friend) => friend.id !== variables.friendId);
      });

      // Return context with the snapshot
      return { previousFriends };
    },
    onError: (err, variables, context) => {
      // If the mutation fails, roll back to the previous value
      if (context?.previousFriends) {
        utils.friends.list.setData(undefined, context.previousFriends);
      }
    },
    onSuccess: () => {
      setShowRemoveDialog(false);
      // Clear selected friend after dialog closes
      setTimeout(() => {
        setSelectedFriend(null);
      }, 300);
    },
    onSettled: async () => {
      // Always refetch after error or success to ensure we're in sync
      await utils.friends.list.invalidate();
    },
  });

  const onRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchFriends(), refetchInbox()]);
    setIsRefreshing(false);
  };

  // Render backdrop for bottom sheet modal
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.3}
        pressBehavior="close"
      />
    ),
    [],
  );

  // Update send mode when hasMedia changes
  useEffect(() => {
    setIsSendMode(hasMedia);
    // Clean up when component unmounts
    return () => setIsSendMode(false);
  }, [hasMedia, setIsSendMode]);

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

    // Mark the first message as read immediately
    const firstMessage = queue[0];
    if (firstMessage?.deliveryId) {
      markRead.mutate({ deliveryId: firstMessage.deliveryId });
    }
  };

  const closeViewer = useCallback(() => {
    setViewer(null);
    // Clear any remaining notifications when closing viewer
    void Notifications.dismissAllNotificationsAsync();
  }, []);

  // Handle hardware back button when viewer is open
  useEffect(() => {
    if (!viewer) return;

    const onBackPress = () => {
      closeViewer();
      return true; // Prevent default behavior
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      onBackPress,
    );

    return () => backHandler.remove();
  }, [viewer, closeViewer]);

  // Handle hardware back button when in send mode (has media)
  useEffect(() => {
    if (!hasMedia) return;

    const onBackPress = () => {
      // If we came from the Media screen with media params, go back to Media
      if (mediaParams?.path && mediaParams.type) {
        navigation.navigate("Media", {
          path: mediaParams.path,
          type: mediaParams.type,
          defaultRecipientId: mediaParams.defaultRecipientId,
          captions: mediaParams.captions,
        });
        return true; // Prevent default behavior
      }
      return false; // Allow default behavior
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      onBackPress,
    );

    return () => backHandler.remove();
  }, [hasMedia, mediaParams, navigation]);

  const onViewerTap = () => {
    if (!viewer) return;
    const nextIndex = viewer.index + 1;
    if (nextIndex < viewer.queue.length) {
      setViewer({ ...viewer, index: nextIndex });
      // Mark the next message as read when advancing
      const nextMessage = viewer.queue[nextIndex];
      if (nextMessage?.deliveryId) {
        markRead.mutate({ deliveryId: nextMessage.deliveryId });
      }
    } else {
      closeViewer();
    }
  };

  const rows = useMemo<FriendRow[]>(() => {
    const senderToMessages = new Map<string, number>();
    for (const m of inbox) {
      if (!m) continue;
      const count = senderToMessages.get(m.senderId) ?? 0;
      senderToMessages.set(m.senderId, count + 1);
    }

    return friends.map((f) => {
      const streak = (f as unknown as { streak?: number }).streak ?? 0;
      const lastActivity = (
        f as unknown as { lastActivityTimestamp?: Date | null }
      ).lastActivityTimestamp;
      const partnerLastActivity = (
        f as unknown as { partnerLastActivityTimestamp?: Date | null }
      ).partnerLastActivityTimestamp;

      return {
        id: f.id,
        name: f.name,
        image: (f as unknown as { image?: string | null }).image ?? null,
        discordId:
          (f as unknown as { discordId?: string | null }).discordId ?? null,
        hasUnread: (senderToMessages.get(f.id) ?? 0) > 0,
        unreadCount: senderToMessages.get(f.id) ?? 0,
        isSelected:
          hasMedia && mediaParams?.defaultRecipientId
            ? f.id === mediaParams.defaultRecipientId
            : false,
        streak,
        lastActivityTimestamp: lastActivity ?? null,
        partnerLastActivityTimestamp: partnerLastActivity ?? null,
        // Calculate hoursRemaining separately on each render for accuracy
        hoursRemaining: null, // Will be calculated during render
      };
    });
  }, [friends, inbox, hasMedia, mediaParams?.defaultRecipientId]);

  // Calculate hoursRemaining fresh on every render (cheap calculation)
  const now = new Date();
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  const rowsWithTimeRemaining = rows.map((row) => {
    if (row.streak === 0 || !row.partnerLastActivityTimestamp) {
      return row;
    }

    const timeSincePartner =
      now.getTime() - new Date(row.partnerLastActivityTimestamp).getTime();
    const timeRemaining = TWENTY_FOUR_HOURS_MS - timeSincePartner;
    const hoursRemaining =
      timeRemaining > 0 ? timeRemaining / (60 * 60 * 1000) : 0;

    return { ...row, hoursRemaining };
  });

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

  // Sync viewer queue with inbox when inbox updates (for instant messages)
  // When inbox refetches after seeding with instant message, we may get additional messages
  // or updated data - keep the viewer in sync
  useEffect(() => {
    if (!viewer || viewer.queue.length === 0) return;

    // Find all messages from the current friend in inbox
    const inboxMessages = inbox.filter(
      (m) => m && m.senderId === viewer.friendId,
    );

    // If inbox has more messages than viewer queue, someone sent multiple messages
    // Update the viewer queue to include all messages
    if (inboxMessages.length > viewer.queue.length) {
      console.log("Inbox has new messages, updating viewer queue");

      // Find the current message we're viewing
      const currentMessage = viewer.queue[viewer.index];
      const matchingIndex = currentMessage
        ? inboxMessages.findIndex(
            (m) => m?.messageId === currentMessage.messageId,
          )
        : 0;

      setViewer({
        ...viewer,
        queue: inboxMessages,
        index: matchingIndex >= 0 ? matchingIndex : viewer.index,
      });

      // Remove from inbox (already viewing)
      utils.messages.inbox.setData(undefined, (old) =>
        old ? old.filter((m) => m && m.senderId !== viewer.friendId) : [],
      );
    }
  }, [inbox, viewer, utils]);

  // Handle deep link to open specific sender's messages
  useEffect(() => {
    const senderId = mediaParams?.openMessageFromSender;
    const instantMessage = mediaParams?.instantMessage;

    console.log("Deep link effect triggered:", {
      openMessageFromSender: senderId,
      hasInstantMessage: !!instantMessage,
      inboxLoading,
      inboxLength: inbox.length,
      viewerOpen: !!viewer,
    });

    if (senderId && !viewer && !inboxLoading) {
      // If we have instant message data, seed the query cache with it! 🚀
      if (instantMessage) {
        console.log(
          "Seeding inbox cache with instant message data (no fetch needed!)",
        );

        // Seed the inbox query cache with the instant message
        // This adds it to the cache as if it came from the server with REAL data!
        utils.messages.inbox.setData(undefined, (old) => {
          const instantMsg = {
            deliveryId: instantMessage.deliveryId, // Real deliveryId from notification!
            messageId: instantMessage.messageId,
            senderId: instantMessage.senderId,
            fileUrl: instantMessage.fileUrl,
            mimeType: instantMessage.mimeType,
            thumbhash: instantMessage.thumbhash,
            createdAt: new Date(),
          };

          // Add instant message to existing inbox (or create new array)
          const updated = old ? [...old, instantMsg] : [instantMsg];
          return updated;
        });

        // Clear the instant message param (keep openMessageFromSender to trigger normal flow)
        navigation.setParams({
          instantMessage: undefined,
        });

        // Invalidate inbox to fetch real data in background (will merge/replace)
        void utils.messages.inbox.invalidate();

        // Let the normal flow below handle opening the viewer
        // (it will find our seeded message and open it)
      }

      // Fallback: No instant message data, use the old flow
      // Check if we already have messages from this sender in the current inbox
      const messagesFromSender = inbox.filter(
        (m) => m && m.senderId === senderId,
      );

      console.log("Checking for messages from sender:", {
        senderId,
        messagesCount: messagesFromSender.length,
        inboxSenders: inbox.map((m) => m?.senderId),
      });

      if (messagesFromSender.length > 0) {
        // Open the message viewer for this sender
        console.log("Opening viewer for sender:", senderId);

        // Optimistically update the inbox to remove messages from this friend
        utils.messages.inbox.setData(undefined, (old) =>
          old ? old.filter((m) => m && m.senderId !== senderId) : [],
        );

        // Clear notifications when opening viewer
        void Notifications.dismissAllNotificationsAsync();

        // Set viewer with messages
        setViewer({
          friendId: senderId,
          queue: messagesFromSender,
          index: 0,
        });

        // Mark the first message as read immediately
        const firstMessage = messagesFromSender[0];
        if (firstMessage?.deliveryId) {
          markRead.mutate({ deliveryId: firstMessage.deliveryId });
        }

        // Clear the param after handling
        navigation.setParams({ openMessageFromSender: undefined });
      } else {
        // No messages found - might be a timing issue, let's refetch once
        console.log("No messages in current inbox, refetching...");
        refetchInbox()
          .then(({ data: freshInbox }) => {
            const freshMessages = (freshInbox ?? []).filter(
              (m) => m && m.senderId === senderId,
            );

            if (freshMessages.length > 0) {
              console.log(
                "Found messages after refetch:",
                freshMessages.length,
              );

              // Optimistically update the inbox
              utils.messages.inbox.setData(undefined, (old) =>
                old ? old.filter((m) => m && m.senderId !== senderId) : [],
              );

              void Notifications.dismissAllNotificationsAsync();

              setViewer({
                friendId: senderId,
                queue: freshMessages,
                index: 0,
              });

              // Mark the first message as read immediately
              const firstMessage = freshMessages[0];
              if (firstMessage?.deliveryId) {
                markRead.mutate({ deliveryId: firstMessage.deliveryId });
              }
            } else {
              console.log("Still no messages found after refetch");
            }

            navigation.setParams({ openMessageFromSender: undefined });
          })
          .catch((error) => {
            console.error("Error refetching inbox:", error);
            navigation.setParams({ openMessageFromSender: undefined });
          });
      }
    }
    // refetchInbox and utils are intentionally excluded from deps to avoid infinite loop.
    // We only want this to run when the deep link parameter or inbox data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mediaParams?.openMessageFromSender,
    mediaParams?.instantMessage,
    inbox,
    inboxLoading,
    viewer,
    navigation,
  ]);

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
    if (q.length === 0) return rowsWithTimeRemaining;
    return rowsWithTimeRemaining.filter((f) =>
      f.name.toLowerCase().includes(q),
    );
  }, [rowsWithTimeRemaining, searchQuery]);

  // Wait for rasterization to complete and use rasterized image
  const [rasterizedImagePath, setRasterizedImagePath] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (mediaParams?.rasterizationPromise) {
      void mediaParams.rasterizationPromise.then((path) => {
        // Use requestAnimationFrame to batch the state update with the next frame
        requestAnimationFrame(() => {
          setRasterizedImagePath(path);
        });
      });
    }
  }, [mediaParams?.rasterizationPromise]);

  const numSelected = selectedFriends.size;

  const isLoading = friendsLoading || inboxLoading;

  // Send mode: Show media preview, search, and send button
  if (hasMedia) {
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
                source={
                  rasterizedImagePath
                    ? { uri: `file://${rasterizedImagePath}` }
                    : mediaParams?.captions && mediaParams.captions.length > 0
                      ? mediaParams.thumbhash
                        ? { thumbhash: mediaParams.thumbhash }
                        : undefined
                      : mediaParams?.path
                        ? { uri: `file://${mediaParams.path}` }
                        : undefined
                }
                style={{ width: 64, height: 64 }}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
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
              className="flex-1"
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
              onPress={() => {
                // If we came from the Media screen with media params, go back to Media
                if (mediaParams?.path && mediaParams.type) {
                  navigation.navigate("Media", {
                    path: mediaParams.path,
                    type: mediaParams.type,
                    defaultRecipientId: mediaParams.defaultRecipientId,
                    captions: mediaParams.captions,
                  });
                } else {
                  navigation.goBack();
                }
              }}
            >
              <Text>Back</Text>
            </Button>
            <Button
              className="w-1/2"
              disabled={numSelected === 0}
              onPress={async () => {
                // mediaParams.type and path must exist if we're in send mode
                if (mediaParams?.type && mediaParams.path) {
                  let finalUri = `file://${mediaParams.path}`;

                  // If there's a rasterization promise, wait for it to complete
                  if (mediaParams.rasterizationPromise) {
                    console.log(
                      "[Friends] Waiting for background rasterization...",
                    );
                    try {
                      const rasterizedPath =
                        await mediaParams.rasterizationPromise;
                      finalUri = `file://${rasterizedPath}`;
                      console.log(
                        "[Friends] Using rasterized image:",
                        finalUri,
                      );
                    } catch (error) {
                      console.error(
                        "[Friends] Rasterization failed, using original:",
                        error,
                      );
                      // Fall back to original if rasterization fails
                    }
                  }

                  void uploadMedia({
                    uri: finalUri,
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
      </View>
    );
  }

  // Normal mode: Show friends list with inbox counts
  return (
    <>
      <View
        className="flex-1 bg-background"
        style={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}
      >
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
              data={filteredRows}
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
                  delayLongPress={300}
                  onLongPress={() => {
                    void Haptics.impactAsync(
                      Haptics.ImpactFeedbackStyle.Medium,
                    );
                    setSelectedFriend(item);
                    bottomSheetRef.current?.present();
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
                    <View className="flex-row items-center gap-2">
                      <Text className="text-base">{item.name}</Text>
                      {item.streak > 0 && (
                        <>
                          <Text className="text-sm font-semibold text-foreground">
                            •
                          </Text>
                          <View className="flex-row items-center gap-1">
                            <Text className="text-sm font-semibold tabular-nums text-foreground">
                              {item.streak}
                            </Text>
                            <Image
                              style={{ width: 24, height: 24, margin: -6 }}
                              source={whispLogo}
                              contentFit="contain"
                            />
                            {item.hoursRemaining !== null &&
                              item.hoursRemaining < 4 && (
                                <Ionicons
                                  name="hourglass"
                                  size={14}
                                  color={
                                    colorScheme === "dark" ? "#fff" : "#000"
                                  }
                                />
                              )}
                          </View>
                        </>
                      )}
                    </View>
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
      </View>

      {/* Message viewer modal */}
      <Modal
        visible={Boolean(viewer)}
        transparent={false}
        animationType="fade"
        onRequestClose={closeViewer}
      >
        <TouchableWithoutFeedback onPress={onViewerTap}>
          <View className="flex-1 bg-black">
            {viewer?.queue[viewer.index]
              ? (() => {
                  const m = viewer.queue[viewer.index];
                  if (!m) return null;
                  const isVideo = (m.mimeType ?? "").startsWith("video/");
                  console.log("Rendering message:", {
                    isVideo,
                    mimeType: m.mimeType,
                    fileUrl: m.fileUrl,
                    hasThumbhash: !!m.thumbhash,
                  });
                  return isVideo ? (
                    <View style={{ width: "100%", height: "100%" }}>
                      {/* Show thumbhash as background while video loads */}
                      {m.thumbhash && (
                        <Image
                          placeholder={{ thumbhash: m.thumbhash }}
                          style={{
                            width: "100%",
                            height: "100%",
                            position: "absolute",
                          }}
                          contentFit="cover"
                        />
                      )}
                      {/* Video renders on top */}
                      <Video
                        ref={videoRef}
                        source={{ uri: m.fileUrl }}
                        style={{ width: "100%", height: "100%" }}
                        resizeMode={ResizeMode.COVER}
                        shouldPlay
                        isLooping={true}
                        useNativeControls={false}
                        onLoad={async () => {
                          // Ensure video plays once loaded
                          console.log("Video loaded, attempting to play");
                          try {
                            const status =
                              await videoRef.current?.getStatusAsync();
                            console.log("Video status:", status);
                            await videoRef.current?.playAsync();
                            console.log("Video play called");
                          } catch (err) {
                            console.error("Error playing video:", err);
                          }
                        }}
                        onError={(error) => {
                          console.error("Video error:", error);
                        }}
                      />
                    </View>
                  ) : (
                    <Image
                      source={{ uri: m.fileUrl }}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="cover"
                      placeholder={
                        m.thumbhash ? { thumbhash: m.thumbhash } : undefined
                      }
                    />
                  );
                })()
              : null}
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Friend actions bottom sheet */}
      <BottomSheetModal
        ref={bottomSheetRef}
        enableDynamicSizing
        enablePanDownToClose
        enableDismissOnClose
        backdropComponent={renderBackdrop}
        onDismiss={() => {
          console.log(
            "BottomSheet onDismiss, isShowingDialog:",
            isShowingDialogRef.current,
            "selectedFriend:",
            selectedFriend,
          );
          // Only clear if dialog is not showing (use ref for synchronous check)
          if (!isShowingDialogRef.current) {
            console.log("Clearing selectedFriend in onDismiss");
            setSelectedFriend(null);
          }
        }}
        backgroundStyle={{ backgroundColor: "#171717" }}
        handleIndicatorStyle={{ backgroundColor: "#525252" }}
      >
        <BottomSheetView className="px-4 pb-8 pt-2">
          <Text className="mb-3 px-2 text-sm font-medium text-muted-foreground">
            {selectedFriend?.name}
          </Text>

          <Pressable
            className="flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-accent"
            onPress={() => {
              if (selectedFriend) {
                if (selectedFriend.unreadCount > 0) {
                  openViewer(selectedFriend.id);
                } else {
                  navigation.navigate("Camera", {
                    defaultRecipientId: selectedFriend.id,
                  });
                }
                bottomSheetRef.current?.close();
              }
            }}
          >
            <Ionicons name="camera" size={22} color="#666" />
            <Text className="text-base">Send whisper</Text>
          </Pressable>

          {selectedFriend?.discordId && (
            <Pressable
              className="flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-accent"
              onPress={() => {
                if (selectedFriend.discordId) {
                  void Linking.openURL(
                    `https://discord.com/users/${selectedFriend.discordId}`,
                  );
                  bottomSheetRef.current?.close();
                }
              }}
            >
              <MaterialIcons name="discord" size={22} color="#666" />
              <Text className="text-base">View Discord Profile</Text>
            </Pressable>
          )}

          <Pressable
            className="flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-accent"
            onPress={() => {
              console.log(
                "Remove Friend pressed, selectedFriend:",
                selectedFriend,
              );
              // Use ref to track dialog state synchronously
              isShowingDialogRef.current = true;
              setShowRemoveDialog(true);
              bottomSheetRef.current?.close();
            }}
          >
            <Ionicons name="person-remove-outline" size={22} color="#ef4444" />
            <Text className="text-base text-destructive">Remove Friend</Text>
          </Pressable>
        </BottomSheetView>
      </BottomSheetModal>

      {/* Remove friend confirmation dialog */}
      <AlertDialog
        open={showRemoveDialog}
        onOpenChange={(open) => {
          console.log(
            "AlertDialog onOpenChange:",
            open,
            "selectedFriend:",
            selectedFriend,
          );
          setShowRemoveDialog(open);
          isShowingDialogRef.current = open;
          // Clear selected friend when dialog closes
          if (!open) {
            setTimeout(() => {
              setSelectedFriend(null);
            }, 300);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Friend</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {selectedFriend?.name} from your
              friends list? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Text>Cancel</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              onPress={() => {
                if (selectedFriend) {
                  removeFriend.mutate({ friendId: selectedFriend.id });
                }
              }}
            >
              <Text>Remove</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
