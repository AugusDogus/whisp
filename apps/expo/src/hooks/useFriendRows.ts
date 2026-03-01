import { useMemo } from "react";

import type { FriendRow, InboxMessage } from "~/components/friends/types";
import type { FriendsListOutput } from "~/utils/api";
import type { MediaKind } from "~/utils/media-kind";
import { mimeToMediaKind } from "~/utils/media-kind";
import type { OutboxState, OutboxStatus } from "~/utils/outbox-status";

interface UseFriendRowsParams {
  friends: FriendsListOutput;
  inbox: (InboxMessage | null)[];
  hasMedia: boolean;
  defaultRecipientId: string | undefined;
  outboxStatus: Record<string, OutboxStatus | undefined>;
  selfUserId: string | null;
}

export function useFriendRows({
  friends,
  inbox,
  hasMedia,
  defaultRecipientId,
  outboxStatus,
  selfUserId,
}: UseFriendRowsParams) {
  const rows = useMemo<FriendRow[]>(() => {
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

      const outbox = outboxStatus[f.id];
      const rawOutboxState = outbox?.state ?? null;
      const outboxState: OutboxState | null =
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

      const effectiveOutgoingMs = Math.max(outgoingMs, outboxMs);
      const latestMs = Math.max(incomingMs, partnerMs, effectiveOutgoingMs);
      const outgoingIsLatest =
        effectiveOutgoingMs > 0 && effectiveOutgoingMs === latestMs;
      const incomingIsLatest = incomingMs > 0 && incomingMs === latestMs;

      let lastMessageStatus: FriendRow["lastMessageStatus"] = null;
      if (outboxState === "uploading" || outboxState === "failed") {
        lastMessageStatus = null;
      } else if (outgoingIsLatest) {
        if (isSelf) lastMessageStatus = "opened";
        else if (lastSentOpened === true) lastMessageStatus = "opened";
        else lastMessageStatus = "sent";
      } else if (incomingIsLatest && hasUnread) {
        lastMessageStatus = "received";
      } else if (partnerLastActivity || incomingLatest) {
        lastMessageStatus = "received_opened";
      }

      const lastMessageAt = latestMs > 0 ? new Date(latestMs) : null;

      let lastMediaKind: MediaKind = "photo";
      if (outboxState === "uploading" || outboxState === "sent") {
        lastMediaKind = outbox?.mediaKind ?? "photo";
      } else if (incomingIsLatest && hasUnread) {
        lastMediaKind = mimeToMediaKind(senderToLatestMime.get(f.id));
      } else if (outgoingIsLatest) {
        lastMediaKind = mimeToMediaKind(f.lastMimeType);
      } else {
        lastMediaKind = mimeToMediaKind(f.lastMimeType);
      }

      return {
        id: f.id,
        name: f.name,
        image: f.image ?? null,
        discordId: f.discordId ?? null,
        hasUnread,
        unreadCount,
        isSelected:
          hasMedia && defaultRecipientId ? f.id === defaultRecipientId : false,
        streak,
        lastActivityTimestamp: lastActivity,
        partnerLastActivityTimestamp: partnerLastActivity,
        hoursRemaining: null,
        lastMessageStatus,
        lastMediaKind,
        lastMessageAt,
        outboxState,
        outboxUpdatedAt,
      };
    });
  }, [friends, inbox, hasMedia, defaultRecipientId, outboxStatus, selfUserId]);

  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  const rowsWithTimeRemaining = useMemo(() => {
    const now = new Date();
    return rows.map((row) => {
      if (row.streak === 0 || !row.partnerLastActivityTimestamp) {
        return row;
      }

      const timeSincePartner =
        now.getTime() - new Date(row.partnerLastActivityTimestamp).getTime();
      const timeRemaining = TWENTY_FOUR_HOURS_MS - timeSincePartner;

      if (timeRemaining <= 0) {
        return { ...row, streak: 0, hoursRemaining: null };
      }

      const hoursRemaining = timeRemaining / (60 * 60 * 1000);
      return { ...row, hoursRemaining };
    });
  }, [rows, TWENTY_FOUR_HOURS_MS]);

  return rowsWithTimeRemaining;
}
