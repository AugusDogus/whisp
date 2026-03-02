import { View } from "react-native";

import { Ionicons } from "@expo/vector-icons";

import type { MediaKind } from "~/utils/media-kind";
import { mediaKindColor } from "~/utils/media-kind";

export type MessageStatus =
  | "sent"
  | "opened"
  | "received"
  | "received_opened"
  | null;

export function getStatusText(
  status: MessageStatus,
  mediaKind: MediaKind = "photo",
): string {
  switch (status) {
    case "sent":
      return "Sent";
    case "opened":
      return "Opened";
    case "received":
      return mediaKind === "video" ? "New Video" : "New Whisp";
    case "received_opened":
      return "Received";
    default:
      return "";
  }
}

/**
 * Snapchat-style status icon with colour based on media kind.
 * Colours come from {@link mediaKindColor} (red for photo, purple for video).
 * - Sent (pending):   filled arrow → accent
 * - Sent (opened):    outline arrow → gray
 * - Received (new):   filled square → accent
 * - Received (opened): outline square → gray
 */
export function MessageStatusIcon({
  status,
  mediaKind = "photo",
}: {
  status: MessageStatus;
  mediaKind?: MediaKind;
}) {
  const activeColor = mediaKindColor(mediaKind);
  switch (status) {
    case "sent":
      return <Ionicons name="arrow-redo" size={14} color={activeColor} />;
    case "opened":
      return <Ionicons name="arrow-redo-outline" size={14} color="#9ca3af" />;
    case "received":
      return (
        <View
          className="size-2.5 rounded-[2px]"
          style={{ backgroundColor: activeColor }}
        />
      );
    case "received_opened":
      return (
        <View className="size-2.5 rounded-[2px] border-[1.5px] border-[#9ca3af]" />
      );
    default:
      return null;
  }
}
