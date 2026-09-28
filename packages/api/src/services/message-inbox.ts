import type { MlsDatabase } from "./mls";

import { and, eq, inArray, isNull } from "@acme/db";
import {
  Message,
  MessageDelivery,
  MlsConversation,
  MlsDraftConversation,
} from "@acme/db/schema";

import { directScope, hasConversationScope } from "./mls-preparation";

/** Return unread deliveries and their direct MLS session in the same response.
 * The locator lets clients resolve display metadata without another delivery
 * request. Opening media still requires fresh device/delivery authorization.
 */
export async function getMessageInbox(database: MlsDatabase, userId: string) {
  const deliveries = await database
    .select({
      deliveryId: MessageDelivery.id,
      messageId: Message.id,
      senderId: Message.senderId,
      groupId: MessageDelivery.groupId,
      fileUrl: Message.fileUrl,
      mimeType: Message.mimeType,
      thumbhash: Message.thumbhash,
      createdAt: Message.createdAt,
    })
    .from(MessageDelivery)
    .innerJoin(Message, eq(Message.id, MessageDelivery.messageId))
    .where(
      and(
        eq(MessageDelivery.recipientId, userId),
        isNull(MessageDelivery.readAt),
      ),
    );
  const encrypted = deliveries.filter(
    (d) => !d.groupId && d.mimeType === "application/vnd.whisp.mls.v1",
  );
  const sessions = encrypted.length
    ? await database
        .select({
          messageId: MlsDraftConversation.draftId,
          conversation: MlsConversation,
        })
        .from(MlsDraftConversation)
        .innerJoin(
          MlsConversation,
          eq(MlsConversation.id, MlsDraftConversation.conversationId),
        )
        .where(
          inArray(
            MlsDraftConversation.draftId,
            encrypted.map((d) => d.messageId),
          ),
        )
    : [];
  return deliveries.map((delivery) => {
    const locator: { conversationId?: string } = {};
    if (
      !delivery.groupId &&
      delivery.mimeType === "application/vnd.whisp.mls.v1"
    ) {
      const scope = directScope(delivery.senderId, userId);
      const session = sessions.find(
        (s) =>
          s.messageId === delivery.messageId &&
          hasConversationScope(s.conversation, scope),
      );
      if (session) locator.conversationId = session.conversation.id;
    }
    return {
      ...delivery,
      ...locator,
      groupId: delivery.groupId ?? undefined,
      mimeType: delivery.mimeType ?? undefined,
      thumbhash: delivery.thumbhash ?? undefined,
    };
  });
}
