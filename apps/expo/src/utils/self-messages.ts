import type { FriendRowInput, InboxMessage } from "~/components/friends/types";

function recipients(
  ids: Iterable<string>,
  selfId: string | null,
  enabled: boolean,
): string[] {
  return Array.from(ids).filter((id) => enabled || id !== selfId);
}

function friends(
  entries: FriendRowInput[],
  self: { id: string; image?: string | null } | null,
  inbox: (InboxMessage | null)[],
  enabled: boolean,
  hasMedia: boolean,
): FriendRowInput[] {
  if (!self) return entries;
  const others = entries.filter((friend) => friend.id !== self.id);
  const hasUnread = inbox.some(
    (message) => message?.senderId === self.id && !message.groupId,
  );
  if (!enabled && (hasMedia || !hasUnread)) return others;
  return [
    {
      id: self.id,
      name: "Me (testing)",
      image: self.image ?? null,
      discordId: null,
      streak: 0,
      shouldShowStreak: false,
      lastActivityTimestamp: null,
      partnerLastActivityTimestamp: null,
      bothSentToday: false,
      isStreakAtRisk: false,
      streakDayEndsAt: null,
      lastSentOpened: null,
      lastMimeType: null,
    },
    ...others,
  ];
}

export const SelfMessages = { recipients, friends } as const;
