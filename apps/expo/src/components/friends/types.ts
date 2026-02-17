import type { MessageStatus } from "./messageStatus";
import type { RouterOutputs } from "~/utils/api";
import type { MediaKind } from "~/utils/media-kind";
import type { OutboxState } from "~/utils/outbox-status";

export type FriendsListFriend = RouterOutputs["friends"]["list"][number];
export type InboxMessage = RouterOutputs["messages"]["inbox"][number];

export interface FriendRow {
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
  lastMediaKind: MediaKind;
  lastMessageAt: Date | null;
  outboxState: OutboxState | null;
  outboxUpdatedAt: Date | null;
}
