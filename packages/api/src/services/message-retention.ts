import { and, inArray, isNotNull, isNull, lt } from "@acme/db";
import type { db } from "@acme/db/client";
import { Message, MessageDelivery } from "@acme/db/schema";

export const MessageRetention = {
  // Called inside the retention transaction, before any storage-provider requests.
  async purge(database: Pick<typeof db, "select" | "delete">, now: Date) {
    const softExpired = and(
      isNotNull(Message.deletedAt),
      lt(Message.deletedAt, new Date(now.getTime() - 30 * 86400_000)),
    );
    const oldUnread = and(
      isNull(Message.deletedAt),
      lt(Message.createdAt, new Date(now.getTime() - 90 * 86400_000)),
    );
    const softDeliveries = await database
      .delete(MessageDelivery)
      .where(
        inArray(
          MessageDelivery.messageId,
          database.select({ id: Message.id }).from(Message).where(softExpired),
        ),
      );
    const softMessages = await database.delete(Message).where(softExpired);
    const oldDeliveries = await database
      .delete(MessageDelivery)
      .where(
        inArray(
          MessageDelivery.messageId,
          database.select({ id: Message.id }).from(Message).where(oldUnread),
        ),
      );
    const oldMessages = await database.delete(Message).where(oldUnread);
    return {
      deletedSoftDeletedMessages: softMessages.rowsAffected,
      deletedSoftDeletedDeliveries: softDeliveries.rowsAffected,
      deletedOldMessages: oldMessages.rowsAffected,
      deletedOldDeliveries: oldDeliveries.rowsAffected,
    };
  },
} as const;
