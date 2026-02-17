import type { ColorSchemeName, ImageSourcePropType } from "react-native";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import type { FriendRow } from "./types";
import { Avatar } from "~/components/ui/avatar";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/utils";
import { mediaKindColor } from "~/utils/media-kind";
import { getRelativeTime } from "./friendsTime";
import { getStatusText, MessageStatusIcon } from "./messageStatus";

export function FriendListRow({
  item,
  whispLogo,
  colorScheme,
  onPress,
  onLongPress,
}: {
  item: FriendRow;
  whispLogo: ImageSourcePropType;
  colorScheme: ColorSchemeName;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      className="flex-row items-center px-4"
      style={{ minHeight: 68 }}
      onPress={onPress}
      delayLongPress={300}
      onLongPress={onLongPress}
      android_ripple={{ color: "rgba(128,128,128,0.12)" }}
    >
      <Avatar userId={item.id} image={item.image} name={item.name} size={44} />
      <View className="ml-3 flex-1 justify-center py-3">
        {/* Top line: Name + streak */}
        <View className="flex-row items-center justify-between">
          <View className="flex-1 flex-row items-center">
            <Text
              className={cn(
                "text-base",
                item.lastMessageStatus === "received" && "font-semibold",
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
                {item.hoursRemaining !== null && item.hoursRemaining < 4 && (
                  <Ionicons
                    name="hourglass"
                    size={12}
                    color={colorScheme === "dark" ? "#fff" : "#000"}
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
            <Text className="text-xs text-muted-foreground">Sending...</Text>
          </View>
        ) : item.outboxState === "failed" ? (
          <View className="mt-0.5 flex-row items-center gap-1.5">
            <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
            <Text className="text-xs font-semibold text-destructive">
              Failed to send
            </Text>
          </View>
        ) : item.lastMessageStatus ? (
          <View className="mt-0.5 flex-row items-center gap-1.5">
            <MessageStatusIcon
              status={item.lastMessageStatus}
              mediaKind={item.lastMediaKind}
            />
            <Text
              className={cn(
                "text-xs",
                item.lastMessageStatus === "received"
                  ? "font-semibold"
                  : "text-muted-foreground",
              )}
              style={
                item.lastMessageStatus === "received"
                  ? { color: mediaKindColor(item.lastMediaKind) }
                  : undefined
              }
            >
              {getStatusText(item.lastMessageStatus, item.lastMediaKind)}
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
  );
}
