import { and, desc, eq, inArray, isNull } from "@acme/db";
import type { db } from "@acme/db/client";
import { Message, MessageDelivery } from "@acme/db/schema";

/**
 * For each friend where I sent the last message, check whether
 * they have unread deliveries of messages I sent.
 * Returns a Set of friend IDs that still have pending (unread) deliveries from me.
 */
export async function getPendingSentDeliveries(
  dbClient: typeof db,
  me: string,
  friendIds: string[],
): Promise<Set<string>> {
  const result = new Set<string>();
  if (friendIds.length === 0) return result;

  const unreadDeliveriesToFriends = await dbClient
    .select({
      messageId: MessageDelivery.messageId,
      recipientId: MessageDelivery.recipientId,
    })
    .from(MessageDelivery)
    .where(
      and(
        inArray(MessageDelivery.recipientId, friendIds),
        isNull(MessageDelivery.readAt),
      ),
    );

  if (unreadDeliveriesToFriends.length === 0) return result;

  const relevantMessageIds = [
    ...new Set(unreadDeliveriesToFriends.map((d) => d.messageId)),
  ];
  const mySentMessages = await dbClient
    .select({ id: Message.id })
    .from(Message)
    .where(
      and(inArray(Message.id, relevantMessageIds), eq(Message.senderId, me)),
    );
  const mySentMessageIdSet = new Set(mySentMessages.map((m) => m.id));

  for (const d of unreadDeliveriesToFriends) {
    if (mySentMessageIdSet.has(d.messageId)) {
      result.add(d.recipientId);
    }
  }

  return result;
}

/**
 * For each friend where I sent the last message, find the mimeType of the
 * most recent message I sent to them.
 */
export async function getLastSentMimeTypes(
  dbClient: typeof db,
  me: string,
  friendIds: string[],
): Promise<Map<string, string | null>> {
  const mimeMap = new Map<string, string | null>();
  if (friendIds.length === 0) return mimeMap;

  const deliveries = await dbClient
    .select({
      recipientId: MessageDelivery.recipientId,
      messageId: MessageDelivery.messageId,
      createdAt: MessageDelivery.createdAt,
    })
    .from(MessageDelivery)
    .innerJoin(Message, eq(Message.id, MessageDelivery.messageId))
    .where(
      and(
        inArray(MessageDelivery.recipientId, friendIds),
        eq(Message.senderId, me),
      ),
    )
    .orderBy(desc(MessageDelivery.createdAt));

  const latestPerRecipient = new Map<string, { messageId: string }>();
  for (const d of deliveries) {
    if (!latestPerRecipient.has(d.recipientId)) {
      latestPerRecipient.set(d.recipientId, { messageId: d.messageId });
    }
  }

  const messageIds = [
    ...new Set([...latestPerRecipient.values()].map((v) => v.messageId)),
  ];
  if (messageIds.length === 0) return mimeMap;

  const msgs = await dbClient
    .select({ id: Message.id, mimeType: Message.mimeType })
    .from(Message)
    .where(inArray(Message.id, messageIds));
  const msgMimeMap = new Map(msgs.map((m) => [m.id, m.mimeType]));

  for (const [recipientId, { messageId }] of latestPerRecipient) {
    mimeMap.set(recipientId, msgMimeMap.get(messageId) ?? null);
  }

  return mimeMap;
}

/**
 * For each friend where they sent the last message to me, find the mimeType
 * of their most recent message.
 */
export async function getLastReceivedMimeTypes(
  dbClient: typeof db,
  me: string,
  friendIds: string[],
): Promise<Map<string, string | null>> {
  const mimeMap = new Map<string, string | null>();
  if (friendIds.length === 0) return mimeMap;

  const deliveries = await dbClient
    .select({
      senderId: Message.senderId,
      mimeType: Message.mimeType,
      createdAt: MessageDelivery.createdAt,
    })
    .from(MessageDelivery)
    .innerJoin(Message, eq(Message.id, MessageDelivery.messageId))
    .where(
      and(
        eq(MessageDelivery.recipientId, me),
        inArray(Message.senderId, friendIds),
      ),
    )
    .orderBy(desc(MessageDelivery.createdAt));

  for (const d of deliveries) {
    if (!mimeMap.has(d.senderId)) {
      mimeMap.set(d.senderId, d.mimeType);
    }
  }

  return mimeMap;
}

/**
 * Derive the `lastSentOpened` status for a friend:
 *   false = I sent last and they haven't opened yet
 *   true  = I sent last and they opened it
 *   null  = they sent last, or no activity
 */
export function deriveLastSentOpened(
  friendId: string,
  sentLastFriendIds: string[],
  hasPendingSentTo: Set<string>,
): boolean | null {
  if (!sentLastFriendIds.includes(friendId)) return null;
  return !hasPendingSentTo.has(friendId);
}
