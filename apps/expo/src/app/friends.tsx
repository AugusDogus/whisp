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

import { AddFriendsPanel } from "~/components/add-friends-panel";
import { FriendsListSkeletonVaried } from "~/components/friends-skeleton";
import { FriendActionsSheet } from "~/components/friends/FriendActionsSheet";
import { FriendsHeader } from "~/components/friends/FriendsHeader";
import { FriendsList } from "~/components/friends/FriendsList";
import { GroupActionsSheet } from "~/components/friends/GroupActionsSheet";
import { LeaveGroupDialog } from "~/components/friends/LeaveGroupDialog";
import { MessageViewerModal } from "~/components/friends/MessageViewerModal";
import { RemoveFriendDialog } from "~/components/friends/RemoveFriendDialog";
import { SendModePanel } from "~/components/friends/SendModePanel";
import type { FriendRow, GroupRow } from "~/components/friends/types";
import { useRecording } from "~/contexts/RecordingContext";
import { useFriendRows } from "~/hooks/useFriendRows";
import { useMarkReadMutation } from "~/hooks/useMarkReadMutation";
import { useMessageFromNotification } from "~/hooks/useMessageFromNotification";
import { useMessageViewerState } from "~/hooks/useMessageViewerState";
import { useRemoveFriend } from "~/hooks/useRemoveFriend";
import { useSendModeSelection } from "~/hooks/useSendModeSelection";
import type { MainTabParamList, RootStackParamList } from "~/navigation/types";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { uploadMedia } from "~/utils/media-upload";
import type { OutboxStatus } from "~/utils/outbox-status";
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
  const { data: groups = [], refetch: refetchGroups } =
    trpc.groups.list.useQuery();
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
  const [selectedGroup, setSelectedGroup] = useState<GroupRow | null>(null);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [showLeaveGroupDialog, setShowLeaveGroupDialog] = useState(false);
  const isShowingDialogRef = useRef(false);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const groupSheetRef = useRef<BottomSheetModal>(null);
  const { markRead, cleanupMessage, utils } = useMarkReadMutation();
  const removeFriend = useRemoveFriend(() => {
    setShowRemoveDialog(false);
    setTimeout(() => {
      setSelectedFriend(null);
    }, 300);
  });

  const leaveGroup = trpc.groups.leave.useMutation({
    onSuccess: () => {
      setShowLeaveGroupDialog(false);
      setTimeout(() => setSelectedGroup(null), 300);
      void utils.groups.list.invalidate();
    },
  });

  const onRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchFriends(), refetchInbox(), refetchGroups()]);
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
      if (mediaParams?.path && mediaParams.type) {
        navigation.navigate("Media", {
          path: mediaParams.path,
          type: mediaParams.type,
          defaultRecipientId: mediaParams.defaultRecipientId,
          groupId: mediaParams.groupId,
          captions: mediaParams.captions,
        });
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      onBackPress,
    );

    return () => backHandler.remove();
  }, [hasMedia, mediaParams, navigation]);

  const rowsWithTimeRemaining = useFriendRows({
    friends,
    inbox,
    hasMedia,
    defaultRecipientId: mediaParams?.defaultRecipientId,
    outboxStatus,
    selfUserId,
  });

  const {
    selectedFriends,
    selectedGroupId,
    toggleFriend,
    toggleGroup,
    rasterizedImagePath,
  } = useSendModeSelection({
    hasMedia,
    defaultRecipientId: mediaParams?.defaultRecipientId,
    defaultGroupId: mediaParams?.groupId,
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

  const filteredGroupRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length === 0) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, searchQuery]);

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
        groupRows={filteredGroupRows}
        rows={filteredRows}
        selectedFriends={selectedFriends}
        selectedGroupId={selectedGroupId}
        toggleFriend={toggleFriend}
        toggleGroup={toggleGroup}
        onBack={() => {
          // If we came from the Media screen with media params, go back to Media
          if (mediaParams?.path && mediaParams.type) {
            navigation.navigate("Media", {
              path: mediaParams.path,
              type: mediaParams.type,
              defaultRecipientId: mediaParams.defaultRecipientId,
              groupId: mediaParams.groupId,
              captions: mediaParams.captions,
            });
          } else {
            navigation.goBack();
          }
        }}
        onSend={async (opts) => {
          if (!mediaParams?.type || !mediaParams.path) return;
          const hasGroup = Boolean(opts.groupId);
          if (!hasGroup && (!opts.recipients || opts.recipients.length === 0))
            return;

          if (!hasGroup && opts.recipients) {
            markWhispUploading(opts.recipients);
          }

          let finalUri = `file://${mediaParams.path}`;
          if (mediaParams.rasterizationPromise) {
            try {
              const rasterizedUri = await mediaParams.rasterizationPromise;
              finalUri = rasterizedUri;
            } catch (error) {
              console.error(
                "[Friends] Rasterization failed, using original:",
                error,
              );
            }
          }

          void uploadMedia({
            uri: finalUri,
            type: mediaParams.type,
            recipients: opts.recipients ?? [],
            groupId: opts.groupId,
          });
          navigation.reset({ index: 0, routes: [{ name: "Main" }] });
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
            onNewGroup={() => navigation.navigate("CreateGroup")}
          />

          {isLoading ? (
            <FriendsListSkeletonVaried />
          ) : showAddFriends ? (
            <View className="flex-1 px-4 pt-2">
              <AddFriendsPanel />
            </View>
          ) : (
            <FriendsList
              groupRows={groups}
              rows={filteredRows}
              isRefreshing={isRefreshing}
              onRefresh={onRefresh}
              whispLogo={whispLogo}
              colorScheme={colorScheme}
              onPressGroupRow={(group) => {
                navigation.navigate("Group", {
                  groupId: group.id,
                  autoOpenUnread: group.unreadCount > 0,
                });
              }}
              onLongPressGroupRow={(group) => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setSelectedGroup(group);
                groupSheetRef.current?.present();
              }}
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

      {/* Group actions bottom sheet */}
      <GroupActionsSheet
        bottomSheetRef={groupSheetRef}
        renderBackdrop={renderBackdrop}
        selectedGroup={selectedGroup}
        clearSelectedGroup={() => setSelectedGroup(null)}
        onOpenGroup={(group) => {
          navigation.navigate("Group", { groupId: group.id });
        }}
        onSendWhisp={(group) => {
          navigation.navigate("Main", {
            screen: "Camera",
            params: { groupId: group.id },
          });
        }}
        onGroupSettings={(group) => {
          navigation.navigate("GroupSettings", { groupId: group.id });
        }}
        onLeaveGroup={() => {
          setShowLeaveGroupDialog(true);
        }}
      />

      <LeaveGroupDialog
        open={showLeaveGroupDialog}
        setOpen={setShowLeaveGroupDialog}
        selectedGroup={selectedGroup}
        onConfirmLeave={() => {
          if (selectedGroup) {
            leaveGroup.mutate({ groupId: selectedGroup.id });
          }
        }}
      />
    </>
  );
}
