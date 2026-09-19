import type { OutboxStatus } from "./outbox-status";

import type { FriendRow, InboxMessage } from "~/components/friends/types";

import { mimeToMediaKind } from "./media-kind";

function recipients(
  ids: Iterable<string>,
  selfId: string | null,
  enabled: boolean,
): string[] {
  return Array.from(ids).filter((id) => enabled || id !== selfId);
}

function rows(
  friends: FriendRow[],
  self: { id: string; image?: string | null } | null,
  inbox: (InboxMessage | null)[],
  enabled: boolean,
  hasMedia: boolean,
  outbox?: OutboxStatus,
): FriendRow[] {
  if (!self) return friends;
  const others = friends.filter((friend) => friend.id !== self.id);
  const unread = inbox.filter(
    (message) => message?.senderId === self.id && !message.groupId,
  );
  if (!enabled && (hasMedia || unread.length === 0)) return others;
  const latest = unread.reduce<InboxMessage | null>(
    (current, message) =>
      !current || (message && message.createdAt > current.createdAt)
        ? message
        : current,
    null,
  );
  return [
    {
      id: self.id,
      name: "Me (testing)",
      image: self.image ?? null,
      discordId: null,
      hasUnread: unread.length > 0,
      unreadCount: unread.length,
      isSelected: false,
      streak: 0,
      shouldShowStreak: false,
      lastActivityTimestamp: null,
      partnerLastActivityTimestamp: null,
      hoursRemaining: null,
      lastMessageStatus: latest ? "received" : null,
      lastMediaKind: outbox?.mediaKind ?? mimeToMediaKind(latest?.mimeType),
      lastMessageAt: latest?.createdAt ?? null,
      outboxState: outbox?.state === "sent" ? null : (outbox?.state ?? null),
      outboxUpdatedAt: outbox ? new Date(outbox.updatedAtMs) : null,
    },
    ...others,
  ];
}

export const SelfMessages = { recipients, rows } as const;
