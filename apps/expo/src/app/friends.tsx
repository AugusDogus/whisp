import type {
  BottomSheetBackdropProps,
  BottomSheetModal,
} from "@gorhom/bottom-sheet";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Linking, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { BottomSheetBackdrop } from "@gorhom/bottom-sheet";
import { useNavigation, useRoute } from "@react-navigation/native";

import type { FriendRow } from "~/components/friends/types";
import type { MainTabParamList, RootStackParamList } from "~/navigation/types";
import type { OutboxStatus } from "~/utils/outbox-status";
import { AddFriendsPanel } from "~/components/add-friends-panel";
import { FriendsListSkeletonVaried } from "~/components/friends-skeleton";
import { FriendActionsSheet } from "~/components/friends/FriendActionsSheet";
import { FriendsHeader } from "~/components/friends/FriendsHeader";
import { FriendsList } from "~/components/friends/FriendsList";
import { MessageViewerModal } from "~/components/friends/MessageViewerModal";
import { RemoveFriendDialog } from "~/components/friends/RemoveFriendDialog";
import { SendModePanel } from "~/components/friends/SendModePanel";
import { useRecording } from "~/contexts/RecordingContext";
import { useMessageFromNotification } from "~/hooks/useMessageFromNotification";
import { useMessageViewerState } from "~/hooks/useMessageViewerState";
import { useSendModeSelection } from "~/hooks/useSendModeSelection";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { mimeToMediaKind } from "~/utils/media-kind";
import { uploadMedia } from "~/utils/media-upload";
import {
  getOutboxStatusSnapshot,
  markWhispUploading,
  subscribeOutboxStatus,
} from "~/utils/outbox-status";
import WhispLogoDark from "../../assets/splash-icon-dark.png";
import WhispLogoLight from "../../assets/splash-icon.png";

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
  const { mutate: cleanupMessage } =
    trpc.messages.cleanupIfAllRead.useMutation();

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

  const {
    viewer,
    inbox,
    openViewer,
    openViewerWithQueue,
    closeViewer,
    onViewerTap,
  } = useMessageViewerState({
    inboxRaw,
    utils,
    markAsRead: (deliveryId) => markRead.mutate({ deliveryId }),
    cleanupMessage,
  });

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
    // Count unread messages per sender and track most recent timestamp + mimeType
    const senderToMessages = new Map<string, number>();
    const senderToLatestTimestamp = new Map<string, Date>();
    const senderToLatestMime = new Map<string, string | undefined>();
    for (const m of inbox) {
      if (!m) continue;
      const count = senderToMessages.get(m.senderId) ?? 0;
      senderToMessages.set(m.senderId, count + 1);

      const current = senderToLatestTimestamp.get(m.senderId);
      if (!current || m.createdAt > current) {
        senderToLatestTimestamp.set(m.senderId, m.createdAt);
        senderToLatestMime.set(m.senderId, m.mimeType);
      }
    }

    return friends.map((f) => {
      const isSelf = selfUserId != null && f.id === selfUserId;
      const streak = f.streak;
      const lastActivity = f.lastActivityTimestamp;
      const partnerLastActivity = f.partnerLastActivityTimestamp;
      const lastSentOpened = f.lastSentOpened;

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
      let lastMessageStatus: FriendRow["lastMessageStatus"] = null;
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

      // Determine the media kind (photo vs video) of the most relevant message.
      // Priority: outbox (uploading/sent) → inbox (received) → API (sent/opened)
      let lastMediaKind: FriendRow["lastMediaKind"] = "photo";
      if (outboxState === "uploading" || outboxState === "sent") {
        lastMediaKind = outbox?.mediaKind ?? "photo";
      } else if (incomingIsLatest && hasUnread) {
        lastMediaKind = mimeToMediaKind(senderToLatestMime.get(f.id));
      } else if (outgoingIsLatest) {
        // Use the API-provided lastMimeType for sent/opened
        const apiMime = f.lastMimeType;
        lastMediaKind = mimeToMediaKind(apiMime);
      } else {
        // received_opened or no activity — use API-provided lastMimeType
        const apiMime = f.lastMimeType;
        lastMediaKind = mimeToMediaKind(apiMime);
      }

      return {
        id: f.id,
        name: f.name,
        image: f.image ?? null,
        discordId: f.discordId ?? null,
        hasUnread,
        unreadCount,
        isSelected:
          hasMedia && mediaParams?.defaultRecipientId
            ? f.id === mediaParams.defaultRecipientId
            : false,
        streak,
        lastActivityTimestamp: lastActivity,
        partnerLastActivityTimestamp: partnerLastActivity,
        hoursRemaining: null, // Calculated during render
        lastMessageStatus,
        lastMediaKind,
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

  const { selectedFriends, toggleFriend, rasterizedImagePath } =
    useSendModeSelection({
      hasMedia,
      defaultRecipientId: mediaParams?.defaultRecipientId,
      rasterizationPromise: mediaParams?.rasterizationPromise,
    });

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

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length === 0) return rowsWithTimeRemaining;
    return rowsWithTimeRemaining.filter((f) =>
      f.name.toLowerCase().includes(q),
    );
  }, [rowsWithTimeRemaining, searchQuery]);

  const isLoading = friendsLoading || inboxLoading;

  // Send mode: Show media preview, search, and send button
  if (hasMedia) {
    return (
      <SendModePanel
        insets={insets}
        mediaPath={mediaParams?.path ?? null}
        rasterizedImagePath={rasterizedImagePath}
        captionsCount={mediaParams?.captions?.length ?? 0}
        thumbhash={mediaParams?.thumbhash}
        searchQuery={searchQuery}
        onChangeSearchQuery={setSearchQuery}
        isLoading={isLoading}
        rows={filteredRows}
        selectedFriends={selectedFriends}
        toggleFriend={toggleFriend}
        onBack={() => {
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
        onSend={async (recipients) => {
          // mediaParams.type and path must exist if we're in send mode
          if (mediaParams?.type && mediaParams.path) {
            // Mark pending immediately (even if we're still rasterizing/prepping).
            markWhispUploading(recipients);

            let finalUri = `file://${mediaParams.path}`;

            // If there's a rasterization promise, wait for it to complete
            if (mediaParams.rasterizationPromise) {
              console.log("[Friends] Waiting for background rasterization...");
              try {
                const rasterizedUri = await mediaParams.rasterizationPromise;
                finalUri = rasterizedUri;
                console.log("[Friends] Using rasterized image:", finalUri);
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
      />
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
          <FriendsHeader
            showAddFriends={showAddFriends}
            onToggleAddFriends={() => setShowAddFriends(!showAddFriends)}
          />

          {isLoading ? (
            <FriendsListSkeletonVaried />
          ) : showAddFriends ? (
            <View className="flex-1 px-4 pt-2">
              <AddFriendsPanel />
            </View>
          ) : (
            <FriendsList
              rows={filteredRows}
              isRefreshing={isRefreshing}
              onRefresh={onRefresh}
              whispLogo={whispLogo}
              colorScheme={colorScheme}
              onPressRow={(item) => {
                if (item.unreadCount > 0) openViewer(item.id);
                else {
                  navigation.navigate("Camera", {
                    defaultRecipientId: item.id,
                  });
                }
              }}
              onLongPressRow={(item) => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setSelectedFriend(item);
                bottomSheetRef.current?.present();
              }}
            />
          )}
        </View>
      </View>

      {/* Message viewer modal */}
      <MessageViewerModal
        viewer={viewer}
        insetsTop={insets.top}
        onRequestClose={closeViewer}
        onTap={onViewerTap}
      />

      {/* Friend actions bottom sheet */}
      <FriendActionsSheet
        bottomSheetRef={bottomSheetRef}
        renderBackdrop={renderBackdrop}
        selectedFriend={selectedFriend}
        isShowingDialogRef={isShowingDialogRef}
        clearSelectedFriend={() => setSelectedFriend(null)}
        onSendWhisp={(friend) => {
          if (friend.unreadCount > 0) openViewer(friend.id);
          else {
            navigation.navigate("Camera", {
              defaultRecipientId: friend.id,
            });
          }
        }}
        onViewDiscordProfile={(discordId) => {
          void Linking.openURL(`https://discord.com/users/${discordId}`);
        }}
        onRemoveFriend={() => setShowRemoveDialog(true)}
      />

      <RemoveFriendDialog
        open={showRemoveDialog}
        setOpen={setShowRemoveDialog}
        selectedFriend={selectedFriend}
        isShowingDialogRef={isShowingDialogRef}
        clearSelectedFriendAfterDelay={() => {
          setTimeout(() => {
            setSelectedFriend(null);
          }, 300);
        }}
        onConfirmRemove={() => {
          if (selectedFriend) {
            removeFriend.mutate({ friendId: selectedFriend.id });
          }
        }}
      />
    </>
  );
}
