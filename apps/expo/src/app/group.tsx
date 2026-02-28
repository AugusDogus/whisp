import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";

import type { InboxMessage } from "~/components/friends/types";
import type { RootStackParamList } from "~/navigation/types";
import { MessageViewerModal } from "~/components/friends/MessageViewerModal";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { GroupAvatar } from "~/components/ui/group-avatar";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";
import WhispLogoDark from "../../assets/splash-icon-dark.png";
import WhispLogoLight from "../../assets/splash-icon.png";

interface GroupInboxItem {
  deliveryId: string;
  messageId: string;
  senderId: string;
  fileUrl: string;
  mimeType?: string;
  thumbhash?: string;
  createdAt: Date;
}

export default function GroupScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "Group">>();
  const { groupId } = route.params;
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const iconColor = colorScheme === "dark" ? "#fff" : "#000";
  const whispLogo = colorScheme === "dark" ? WhispLogoDark : WhispLogoLight;

  const {
    data: group,
    isLoading: groupLoading,
    refetch: refetchGroup,
  } = trpc.groups.get.useQuery({ groupId }, { enabled: !!groupId });
  const {
    data: inboxRaw = [],
    refetch: refetchInbox,
    isLoading: inboxLoading,
  } = trpc.groups.inbox.useQuery({ groupId }, { enabled: !!groupId });

  const [isRefreshing, setIsRefreshing] = useState(false);
  const onRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchGroup(), refetchInbox()]);
    setIsRefreshing(false);
  };

  const utils = trpc.useUtils();
  const markRead = trpc.messages.markRead.useMutation({
    onSettled: () => {
      void utils.groups.inbox.invalidate({ groupId });
      void utils.groups.list.invalidate();
      void utils.messages.inbox.invalidate();
    },
  });
  const { mutate: cleanupMessage } =
    trpc.messages.cleanupIfAllRead.useMutation();

  const [viewer, setViewer] = useState<{
    friendId: string;
    queue: InboxMessage[];
    index: number;
  } | null>(null);

  const openViewer = useCallback(
    (messages: GroupInboxItem[], startIndex: number) => {
      if (messages.length === 0) return;
      const asInbox: InboxMessage[] = messages.map((m) => ({
        deliveryId: m.deliveryId,
        messageId: m.messageId,
        senderId: m.senderId,
        groupId: groupId,
        fileUrl: m.fileUrl,
        mimeType: m.mimeType,
        thumbhash: m.thumbhash,
        createdAt: m.createdAt,
      }));
      setViewer({ friendId: groupId, queue: asInbox, index: startIndex });
      const first = asInbox[startIndex];
      if (first?.deliveryId) {
        markRead.mutate({ deliveryId: first.deliveryId });
      }
    },
    [groupId, markRead],
  );

  const closeViewer = useCallback(() => {
    if (viewer) {
      const messageIds = new Set(
        viewer.queue
          .map((m) => m?.messageId)
          .filter((id): id is string => Boolean(id)),
      );
      for (const messageId of messageIds) {
        cleanupMessage({ messageId });
      }
    }
    setViewer(null);
  }, [cleanupMessage, viewer]);

  const onViewerTap = useCallback(() => {
    if (!viewer) return;
    const nextIndex = viewer.index + 1;
    if (nextIndex < viewer.queue.length) {
      setViewer({ ...viewer, index: nextIndex });
      const nextMsg = viewer.queue[nextIndex];
      if (nextMsg?.deliveryId) {
        markRead.mutate({ deliveryId: nextMsg.deliveryId });
      }
    } else {
      closeViewer();
    }
  }, [closeViewer, markRead, viewer]);

  const isLoading = groupLoading || inboxLoading;

  const onSendWhisp = useCallback(() => {
    navigation.navigate("Main", {
      screen: "Camera",
      params: { groupId },
    });
  }, [navigation, groupId]);

  const onSettings = useCallback(() => {
    navigation.navigate("GroupSettings", { groupId });
  }, [navigation, groupId]);

  const getMemberInfo = useCallback(
    (senderId: string) => {
      const member = group?.members.find((m) => m.id === senderId);
      return {
        name: member?.name ?? "Someone",
        image: member?.image ?? null,
      };
    },
    [group?.members],
  );

  const headerAvatars = useMemo(
    () =>
      (group?.members ?? [])
        .slice(0, 4)
        .map((m) => ({ userId: m.id, image: m.image })),
    [group?.members],
  );

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
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3">
        <View className="flex-1 flex-row items-center gap-3">
          <Pressable
            onPress={() => navigation.goBack()}
            className="size-10 items-center justify-center rounded-full"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={24} color={iconColor} />
          </Pressable>
          <Pressable
            onPress={onSettings}
            className="flex-1 flex-row items-center gap-3 active:opacity-70"
          >
            <GroupAvatar members={headerAvatars} size={40} />
            <View className="flex-1">
              <Text className="text-base font-semibold" numberOfLines={1}>
                {group?.name ?? "..."}
              </Text>
              {group?.members && (
                <Text
                  className="text-xs text-muted-foreground"
                  numberOfLines={1}
                >
                  {group.members.length} member
                  {group.members.length !== 1 ? "s" : ""}
                </Text>
              )}
            </View>
          </Pressable>
        </View>
        <Pressable
          onPress={onSettings}
          className="size-10 items-center justify-center rounded-full"
          accessibilityLabel="Group settings"
        >
          <Ionicons name="settings-sharp" size={22} color={iconColor} />
        </Pressable>
      </View>

      {/* Content */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted-foreground">Loading...</Text>
        </View>
      ) : inboxRaw.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <Image
            source={whispLogo}
            style={{ width: 56, height: 56, opacity: 0.35 }}
            contentFit="contain"
          />
          <Text className="text-center text-muted-foreground">
            No unread whisps
          </Text>
          <Button className="mt-2" onPress={onSendWhisp}>
            <Text>Send a whisp</Text>
          </Button>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          data={inboxRaw}
          keyExtractor={(item) => item.deliveryId}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
          }
          ListHeaderComponent={
            <View className="px-4 py-2">
              <Text className="text-sm font-medium text-muted-foreground">
                {inboxRaw.length} unread whisp
                {inboxRaw.length !== 1 ? "s" : ""}
              </Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const member = getMemberInfo(item.senderId);
            return (
              <Pressable
                className="flex-row items-center px-4"
                style={{ minHeight: 68 }}
                onPress={() => openViewer(inboxRaw, index)}
                android_ripple={{ color: "rgba(128,128,128,0.12)" }}
              >
                <Avatar
                  userId={item.senderId}
                  image={member.image}
                  name={member.name}
                  size={44}
                />
                <View className="ml-3 flex-1 justify-center py-3">
                  <Text className="text-base font-semibold">{member.name}</Text>
                  <Text className="mt-0.5 text-xs text-muted-foreground">
                    Tap to view
                  </Text>
                </View>
                <View className="items-center justify-center rounded-full bg-primary px-2 py-0.5">
                  <Text className="text-xs font-semibold tabular-nums text-primary-foreground">
                    New
                  </Text>
                </View>
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => (
            <View className="ml-[68px] h-px bg-border" />
          )}
        />
      )}

      {/* Bottom send button when there are messages */}
      {inboxRaw.length > 0 && (
        <View className="border-t border-border px-4 py-3">
          <Button onPress={onSendWhisp}>
            <Text>Send a whisp</Text>
          </Button>
        </View>
      )}

      <MessageViewerModal
        viewer={viewer}
        insetsTop={insets.top}
        onRequestClose={closeViewer}
        onTap={onViewerTap}
      />
    </View>
  );
}
