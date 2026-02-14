import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Video as VideoType } from "expo-av";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import type { OutboxState, OutboxStatus } from "~/utils/outbox-status";
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
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { useRecording } from "~/contexts/RecordingContext";
import { useMessageFromNotification } from "~/hooks/useMessageFromNotification";
import { cn } from "~/lib/utils";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { uploadMedia } from "~/utils/media-upload";
import {
  getOutboxStatusSnapshot,
  markWhispUploading,
  subscribeOutboxStatus,
} from "~/utils/outbox-status";
import WhispLogoDark from "../../assets/splash-icon-dark.png";
import WhispLogoLight from "../../assets/splash-icon.png";

type MessageStatus = "sent" | "opened" | "received" | "received_opened" | null;

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
  lastMessageStatus: MessageStatus;
  lastMessageAt: Date | null;
  outboxState: OutboxState | null;
  outboxUpdatedAt: Date | null;
}

/**
 * Returns a compact relative timestamp like Snapchat.
 * e.g. "Just now", "3m ago", "2h ago", "1d ago", "2w ago", "Jan 5"
 */
function getRelativeTime(date: Date | null): string {
  if (!date) return "";
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  if (diff < 0) return "Just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function getStatusText(status: MessageStatus): string {
  switch (status) {
    case "sent":
      return "Sent";
    case "opened":
      return "Opened";
    case "received":
      return "New Whisp";
    case "received_opened":
      return "Received";
    default:
      return "";
  }
}

/**
 * Snapchat-style status icon.
 * - Sent (pending):   filled arrow → red
 * - Sent (opened):    outline arrow → gray
 * - Received (new):   filled square → red
 * - Received (opened): outline square → gray
 */
function MessageStatusIcon({ status }: { status: MessageStatus }) {
  switch (status) {
    case "sent":
      return <Ionicons name="arrow-redo" size={14} color="#ef4444" />;
    case "opened":
      return <Ionicons name="arrow-redo-outline" size={14} color="#9ca3af" />;
    case "received":
      return (
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 2,
            backgroundColor: "#ef4444",
          }}
        />
      );
    case "received_opened":
      return (
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 2,
            borderWidth: 1.5,
            borderColor: "#9ca3af",
          }}
        />
      );
    default:
      return null;
  }
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
  const { data: session } = authClient.useSession();
  const selfUserId = session?.user.id ?? null;

  // Select the appropriate logo based on color scheme
  const whispLogo = colorScheme === "dark" ? WhispLogoDark : WhispLogoLight;

  const {
    data: friends = [],
    refetch: refetchFriends,
    isLoading: friendsLoading,
  } = trpc.friends.list.useQuery();
  const {
    data: inboxRaw = [],
    refetch: refetchInbox,
    isLoading: inboxLoading,
  } = trpc.messages.inbox.useQuery();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [outboxStatus, setOutboxStatus] = useState<
    Record<string, OutboxStatus | undefined>
  >(() => getOutboxStatusSnapshot());
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

  // Track background uploads so the list can show per-friend pending state.
  useEffect(() => {
    const unsubscribe = subscribeOutboxStatus(setOutboxStatus);
    return () => {
      unsubscribe();
    };
  }, []);

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

  /**
   * Message Viewer State
   * ====================
   * Expected behavior:
   * - viewer holds the current message being viewed and the queue of messages
   * - When a message is opened, it's removed from inbox and added to viewer
   * - User taps to advance through messages in the queue
   * - When queue is exhausted, viewer closes automatically
   */
  const [viewer, setViewer] = useState<{
    friendId: string;
    queue: typeof inboxRaw;
    index: number;
  } | null>(null);

  /**
   * Filter Inbox to Exclude Messages in Viewer
   * ===========================================
   * Expected behavior:
   * - If viewer is open, filter out all messages in the viewer queue from inbox
   * - This prevents messages from reappearing during manual refresh
   * - Race condition protection: Even if server hasn't processed markRead yet,
   *   we won't show messages that are actively being viewed
   *
   * Scenario this fixes:
   * 1. Open message from notification (optimistically removed from inbox)
   * 2. markRead mutation starts (async)
   * 3. User pulls to refresh
   * 4. Server returns message as unread (markRead not complete yet)
   * 5. Without this filter: message reappears ❌
   * 6. With this filter: message stays hidden while in viewer ✅
   */
  const inbox = viewer
    ? inboxRaw.filter((msg) => {
        if (!msg) return true;
        // Exclude any message that's in the viewer queue
        return !viewer.queue.some(
          (viewerMsg) => viewerMsg?.deliveryId === msg.deliveryId,
        );
      })
    : inboxRaw;

  /**
   * Opens the message viewer for a specific friend
   * Expected behavior:
   * - Filters inbox to get all messages from this friend
   * - Removes those messages from inbox (optimistic update)
   * - Clears notifications
   * - Opens viewer with first message
   * - Marks first message as read immediately
   */
  const openViewer = (friendId: string) => {
    const queue = inbox.filter((m) => m?.senderId === friendId);
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

  /**
   * Opens the message viewer with a pre-filtered queue
   * Used by push notification handler to open messages directly
   */
  const openViewerWithQueue = useCallback((messages: typeof inbox) => {
    if (messages.length === 0) return;

    const senderId = messages[0]?.senderId;
    if (!senderId) return;

    setViewer({ friendId: senderId, queue: messages, index: 0 });
  }, []);

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

  /**
   * Handles taps on the message viewer
   * Expected behavior:
   * - Advance to next message in queue
   * - Mark the new message as read immediately
   * - If no more messages in queue, close the viewer
   * - This creates a "story-style" viewing experience
   */
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

  /**
   * Friend List Rows - Expected Behavior
   * =====================================
   * Combines friend data with inbox data to create the displayed rows
   *
   * Expected:
   * - Shows unread message count for each friend
   * - Shows current streak and time remaining
   * - Marks pre-selected friend when in send mode
   * - Recalculates on every render for real-time updates
   */
  const rows = useMemo<FriendRow[]>(() => {
    // Count unread messages per sender and track most recent timestamp
    const senderToMessages = new Map<string, number>();
    const senderToLatestTimestamp = new Map<string, Date>();
    for (const m of inbox) {
      if (!m) continue;
      const count = senderToMessages.get(m.senderId) ?? 0;
      senderToMessages.set(m.senderId, count + 1);

      const current = senderToLatestTimestamp.get(m.senderId);
      if (!current || m.createdAt > current) {
        senderToLatestTimestamp.set(m.senderId, m.createdAt);
      }
    }

    return friends.map((f) => {
      const isSelf = selfUserId != null && f.id === selfUserId;
      const streak = (f as unknown as { streak?: number }).streak ?? 0;
      const lastActivity = (
        f as unknown as { lastActivityTimestamp?: Date | null }
      ).lastActivityTimestamp;
      const partnerLastActivity = (
        f as unknown as { partnerLastActivityTimestamp?: Date | null }
      ).partnerLastActivityTimestamp;
      const lastSentOpened =
        (f as unknown as { lastSentOpened?: boolean | null }).lastSentOpened ??
        null;

      const unreadCount = senderToMessages.get(f.id) ?? 0;
      const hasUnread = unreadCount > 0;

      // Dev-only "send to yourself" can otherwise get stuck looking like an
      // unopened sent message forever (you're both sender and recipient).
      // We still want to show pending/error UI, but we ignore the "sent" override.
      const outbox = outboxStatus[f.id];
      const rawOutboxState = outbox?.state ?? null;
      const outboxState =
        isSelf && rawOutboxState === "sent" ? null : rawOutboxState;
      const outboxUpdatedAt =
        outboxState && outbox?.updatedAtMs
          ? new Date(outbox.updatedAtMs)
          : null;

      const incomingLatest = senderToLatestTimestamp.get(f.id) ?? null;
      const incomingMs = incomingLatest?.getTime() ?? 0;
      const outgoingMs = lastActivity ? new Date(lastActivity).getTime() : 0;
      const partnerMs = partnerLastActivity
        ? new Date(partnerLastActivity).getTime()
        : 0;
      const outboxMs =
        outboxState === "uploading" || outboxState === "sent"
          ? (outboxUpdatedAt?.getTime() ?? 0)
          : 0;

      // Prefer whichever direction is newest so "Sent" can replace stale "Received"
      // after we upload a whisp (even if the inbox still contains older messages).
      const effectiveOutgoingMs = Math.max(outgoingMs, outboxMs);
      const latestMs = Math.max(incomingMs, partnerMs, effectiveOutgoingMs);
      const outgoingIsLatest =
        effectiveOutgoingMs > 0 && effectiveOutgoingMs === latestMs;
      const incomingIsLatest = incomingMs > 0 && incomingMs === latestMs;

      // Compute Snapchat-style message status
      let lastMessageStatus: MessageStatus = null;
      if (outboxState === "uploading" || outboxState === "failed") {
        // Rendered specially; keep lastMessageStatus null.
        lastMessageStatus = null;
      } else if (outgoingIsLatest) {
        // For self-chat, treat outgoing as opened (can't be unopened).
        if (isSelf) lastMessageStatus = "opened";
        else if (lastSentOpened === true) lastMessageStatus = "opened";
        else lastMessageStatus = "sent";
      } else if (incomingIsLatest && hasUnread) {
        lastMessageStatus = "received";
      } else if (partnerLastActivity || incomingLatest) {
        lastMessageStatus = "received_opened";
      }

      const lastMessageAt = latestMs > 0 ? new Date(latestMs) : null;

      return {
        id: f.id,
        name: f.name,
        image: (f as unknown as { image?: string | null }).image ?? null,
        discordId:
          (f as unknown as { discordId?: string | null }).discordId ?? null,
        hasUnread,
        unreadCount,
        isSelected:
          hasMedia && mediaParams?.defaultRecipientId
            ? f.id === mediaParams.defaultRecipientId
            : false,
        streak,
        lastActivityTimestamp: lastActivity ?? null,
        partnerLastActivityTimestamp: partnerLastActivity ?? null,
        hoursRemaining: null, // Calculated during render
        lastMessageStatus,
        lastMessageAt,
        outboxState,
        outboxUpdatedAt,
      };
    });
  }, [
    friends,
    inbox,
    hasMedia,
    mediaParams?.defaultRecipientId,
    outboxStatus,
    selfUserId,
  ]);

  /**
   * Time Remaining Calculation
   * ===========================
   * Expected behavior:
   * - Calculate hours remaining in the 24-hour window for each streak
   * - Only show if streak > 0 and partner has sent recently
   * - Updates on every render for real-time countdown
   * - Shows hourglass icon if < 4 hours remaining (urgency indicator)
   */
  const now = new Date();
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  const rowsWithTimeRemaining = rows.map((row) => {
    if (row.streak === 0 || !row.partnerLastActivityTimestamp) {
      return row;
    }

    const timeSincePartner =
      now.getTime() - new Date(row.partnerLastActivityTimestamp).getTime();
    const timeRemaining = TWENTY_FOUR_HOURS_MS - timeSincePartner;

    // If more than 24 hours have passed, the streak has expired
    // Treat as streak 0 on the client (server will update on next message)
    if (timeRemaining <= 0) {
      return { ...row, streak: 0, hoursRemaining: null };
    }

    const hoursRemaining = timeRemaining / (60 * 60 * 1000);

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

  /**
   * Sync Viewer Queue with Inbox - Expected Behavior
   * =================================================
   * When the inbox updates (e.g., after refetching or receiving new messages),
   * we need to check if the viewer should be updated with new messages.
   *
   * Expected:
   * - If user is viewing messages and friend sends more, add them to viewer queue
   * - Preserve current viewing position (don't skip to new messages)
   * - Remove new messages from inbox since they're now in viewer
   * - This enables continuous viewing without closing/reopening
   */
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

  /**
   * Handle opening messages from push notifications
   * Delegates to custom hook for cleaner code organization
   */
  useMessageFromNotification({
    senderId: mediaParams?.openMessageFromSender,
    instantMessage: mediaParams?.instantMessage,
    inbox,
    inboxLoading,
    viewerOpen: !!viewer,
    utils,
    clearParams: () => {
      navigation.setParams({
        openMessageFromSender: undefined,
        instantMessage: undefined,
      });
    },
    openViewer: openViewerWithQueue,
    markAsRead: (deliveryId) => markRead.mutate({ deliveryId }),
    refetchInbox: () =>
      refetchInbox().then((result) => ({ data: result.data })),
  });

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
                  const recipients = Array.from(selectedFriends);
                  // Mark pending immediately (even if we're still rasterizing/prepping).
                  markWhispUploading(recipients);

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
                    recipients,
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
                  className="flex-row items-center px-4"
                  style={{ minHeight: 68 }}
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
                  android_ripple={{ color: "rgba(128,128,128,0.12)" }}
                >
                  <Avatar
                    userId={item.id}
                    image={item.image}
                    name={item.name}
                    size={44}
                  />
                  <View className="ml-3 flex-1 justify-center py-3">
                    {/* Top line: Name + streak */}
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1 flex-row items-center">
                        <Text
                          className={cn(
                            "text-base",
                            item.lastMessageStatus === "received" &&
                              "font-semibold",
                          )}
                          numberOfLines={1}
                        >
                          {item.name}
                        </Text>
                        {item.streak > 0 && (
                          <View className="ml-1.5 flex-row items-center">
                            <Image
                              style={{ width: 20, height: 20, margin: -4 }}
                              source={whispLogo}
                              contentFit="contain"
                            />
                            <Text className="ml-0.5 text-sm font-semibold tabular-nums text-foreground">
                              {item.streak}
                            </Text>
                            {item.hoursRemaining !== null &&
                              item.hoursRemaining < 4 && (
                                <Ionicons
                                  name="hourglass"
                                  size={12}
                                  color={
                                    colorScheme === "dark" ? "#fff" : "#000"
                                  }
                                  style={{ marginLeft: 2 }}
                                />
                              )}
                          </View>
                        )}
                      </View>
                      {item.hasUnread && (
                        <View className="ml-2 items-center justify-center rounded-full bg-primary px-2 py-0.5">
                          <Text className="text-xs font-semibold tabular-nums text-primary-foreground">
                            {item.unreadCount}
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Bottom line: Status icon + text + timestamp */}
                    {item.outboxState === "uploading" ? (
                      <View className="mt-0.5 flex-row items-center gap-1.5">
                        <ActivityIndicator
                          size="small"
                          color={colorScheme === "dark" ? "#9ca3af" : "#6b7280"}
                        />
                        <Text className="text-xs text-muted-foreground">
                          Sending...
                        </Text>
                      </View>
                    ) : item.outboxState === "failed" ? (
                      <View className="mt-0.5 flex-row items-center gap-1.5">
                        <Ionicons
                          name="alert-circle-outline"
                          size={14}
                          color="#ef4444"
                        />
                        <Text className="text-xs font-semibold text-destructive">
                          Failed to send
                        </Text>
                      </View>
                    ) : item.lastMessageStatus ? (
                      <View className="mt-0.5 flex-row items-center gap-1.5">
                        <MessageStatusIcon status={item.lastMessageStatus} />
                        <Text
                          className={cn(
                            "text-xs",
                            item.lastMessageStatus === "received"
                              ? "font-semibold"
                              : "text-muted-foreground",
                          )}
                          style={
                            item.lastMessageStatus === "received"
                              ? { color: "#ef4444" }
                              : undefined
                          }
                        >
                          {getStatusText(item.lastMessageStatus)}
                        </Text>
                        {item.lastMessageAt && (
                          <Text className="text-xs text-muted-foreground">
                            {"· "}
                            {getRelativeTime(item.lastMessageAt)}
                          </Text>
                        )}
                      </View>
                    ) : (
                      <Text className="mt-0.5 text-xs text-muted-foreground">
                        Tap to send a whisp
                      </Text>
                    )}
                  </View>
                </Pressable>
              )}
              ItemSeparatorComponent={() => (
                <View className="ml-[68px] h-px bg-border" />
              )}
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
            <Text className="text-base">Send whisp</Text>
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
