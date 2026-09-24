import type {
  BottomSheetBackdropProps,
  BottomSheetModal,
} from "@gorhom/bottom-sheet";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as Haptics from "expo-haptics";

import { BottomSheetBackdrop } from "@gorhom/bottom-sheet";
import {
  useIsFocused,
  useFocusEffect,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";

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
import { Text } from "~/components/ui/text";
import { useFriendRows } from "~/hooks/useFriendRows";
import { useInboxCiphertext } from "~/hooks/useInboxCiphertext";
import { useInboxMediaKinds } from "~/hooks/useInboxMediaKinds";
import { useMessageFromNotification } from "~/hooks/useMessageFromNotification";
import { useMessageViewerState } from "~/hooks/useMessageViewerState";
import { usePreviewSettings } from "~/hooks/usePreviewSettings";
import { useRemoveFriend } from "~/hooks/useRemoveFriend";
import { useSendModeSelection } from "~/hooks/useSendModeSelection";
import { useSentMediaKinds } from "~/hooks/useSentMediaKinds";
import type { MainTabParamList, RootStackParamList } from "~/navigation/types";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { uploadMedia } from "~/utils/media-upload";
import { localMediaUri } from "~/utils/media-uri";
import type { OutboxStatus } from "~/utils/outbox-status";
import {
  getOutboxStatusSnapshot,
  markWhispUploading,
  subscribeOutboxStatus,
} from "~/utils/outbox-status";
import { SelfMessages } from "~/utils/self-messages";

import WhispLogoDark from "../../assets/splash-icon-dark.png";
import WhispLogoLight from "../../assets/splash-icon.png";

export default function FriendsScreen() {
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<
    | RouteProp<MainTabParamList, "Friends">
    | RouteProp<RootStackParamList, "Send">
  >();
  const mediaParams = route.params;
  const hasMedia = route.name === "Send";
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const { data: session } = authClient.useSession();
  const selfUserId = session?.user.id ?? null;
  const { allowSelfMessages } = usePreviewSettings();

  // Select the appropriate logo based on color scheme
  const whispLogo = colorScheme === "dark" ? WhispLogoDark : WhispLogoLight;

  const {
    data: friends = [],
    refetch: refetchFriends,
    isLoading: friendsLoading,
  } = trpc.friends.list.useQuery(undefined, {
    refetchOnWindowFocus: "always",
    // Recover missed/disabled push notifications only while this list is visible.
    refetchInterval: isFocused && !hasMedia ? 15_000 : false,
  });
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
  >(() => getOutboxStatusSnapshot(queryClient));
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddFriends, setShowAddFriends] = useState(false);
  const [selectedFriend, setSelectedFriend] = useState<FriendRow | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupRow | null>(null);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [showLeaveGroupDialog, setShowLeaveGroupDialog] = useState(false);
  const isShowingDialogRef = useRef(false);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const groupSheetRef = useRef<BottomSheetModal>(null);
  const utils = trpc.useUtils();
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
    try {
      await Promise.all([
        refetchFriends(),
        refetchInbox(),
        refetchGroups(),
        utils.friends.incomingRequests.invalidate(),
        utils.friends.searchUsers.invalidate(),
        queryClient.invalidateQueries({ queryKey: ["whisp-media-kind"] }),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      void refetchFriends();
    }, [refetchFriends]),
  );

  // Track background uploads so the list can show per-friend pending state.
  useEffect(() => {
    const unsubscribe = subscribeOutboxStatus(queryClient, setOutboxStatus);
    return () => {
      unsubscribe();
    };
  }, [queryClient]);

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
  });
  useInboxCiphertext(inboxRaw, selfUserId, isFocused && !hasMedia && !viewer);
  const mediaTypes = useInboxMediaKinds(
    inbox,
    isFocused && !!selfUserId && !viewer && !hasMedia,
  );

  const visibleFriends = useMemo(
    () =>
      SelfMessages.friends(
        friends,
        session?.user ?? null,
        inbox,
        allowSelfMessages,
        hasMedia,
      ),
    [friends, session?.user, inbox, allowSelfMessages, hasMedia],
  );
  const rowsWithTimeRemaining = useFriendRows({
    friends: visibleFriends,
    inbox,
    hasMedia,
    defaultRecipientId: mediaParams?.defaultRecipientId,
    outboxStatus,
    selfUserId,
    mediaKinds: mediaTypes.mediaKinds,
    sentMediaKinds: useSentMediaKinds(visibleFriends),
  });

  const {
    selectedFriends: selection,
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
  const selectedFriends = new Set(
    SelfMessages.recipients(selection, selfUserId, allowSelfMessages),
  );

  /**
   * Handle opening messages from push notifications
   * Delegates to custom hook for cleaner code organization
   */
  useMessageFromNotification({
    senderId: mediaParams?.openMessageFromSender,
    inboxLoading,
    viewerOpen: !!viewer,
    clearParams: () => {
      navigation.setParams({
        openMessageFromSender: undefined,
        instantMessage: undefined,
      });
    },
    openViewer: openViewerWithQueue,
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
        onBack={() => navigation.goBack()}
        onSend={async (opts) => {
          if (!mediaParams?.type || !mediaParams.path) return;
          const recipients = SelfMessages.recipients(
            opts.recipients ?? [],
            selfUserId,
            allowSelfMessages,
          );
          const hasGroup = Boolean(opts.groupId);
          if (!hasGroup && recipients.length === 0) return;

          if (!hasGroup) {
            markWhispUploading(queryClient, recipients);
          }

          let finalUri = localMediaUri(mediaParams.path);
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
            queryClient,
            uri: finalUri,
            type: mediaParams.type,
            recipients,
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
        <View className="flex-1">
          <FriendsHeader
            showAddFriends={showAddFriends}
            onToggleAddFriends={() => setShowAddFriends(!showAddFriends)}
            onNewGroup={() => navigation.navigate("CreateGroup")}
            onRefresh={onRefresh}
            isRefreshing={isRefreshing}
          />

          {mediaTypes.hasError && !isLoading && !showAddFriends && (
            <Text
              accessibilityRole="alert"
              className="px-4 py-2 text-sm text-muted"
            >
              Some whisp types couldn't load. Pull to refresh, or tap a whisp to
              open it.
            </Text>
          )}

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
                if (item.id === selfUserId) return;
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
