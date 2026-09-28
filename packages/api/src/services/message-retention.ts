import { and, inArray, isNotNull, isNull, lt } from "@acme/db";
import type { db } from "@acme/db/client";
import {
  FileDeletion,
  Message,
  MessageDelivery,
  MlsDraft,
} from "@acme/db/schema";

import { FileDeletions } from "./file-deletions";

export const MessageRetention = {
  // Called inside the retention transaction, before any storage-provider requests.
  async purge(
    database: Pick<typeof db, "select" | "insert" | "delete">,
    now: Date,
  ) {
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
    // Completed MLS drafts share their message ID and expire with it.
    await database
      .delete(MlsDraft)
      .where(
        inArray(
          MlsDraft.id,
          database.select({ id: Message.id }).from(Message).where(softExpired),
        ),
      );
    const softMessages = await database.delete(Message).where(softExpired);
    // Unread messages never reached cleanupIfAllRead, so their files still exist.
    // This includes messages whose deliveries a block removed. Queue each file
    // before deleting the row that holds its key. Soft-deleted files were
    // already removed when the last viewer closed.
    const unreadFiles = await database
      .select({ fileKey: Message.fileKey, fileUrl: Message.fileUrl })
      .from(Message)
      .where(oldUnread);
    const keys = [
      ...new Set(
        unreadFiles.map(FileDeletions.keyOf).filter((key) => key !== undefined),
      ),
    ];
    if (keys.length > 0)
      await database
        .insert(FileDeletion)
        .values(keys.map((fileKey) => ({ fileKey })))
        .onConflictDoNothing();
    const oldDeliveries = await database
      .delete(MessageDelivery)
      .where(
        inArray(
          MessageDelivery.messageId,
          database.select({ id: Message.id }).from(Message).where(oldUnread),
        ),
      );
    await database
      .delete(MlsDraft)
      .where(
        inArray(
          MlsDraft.id,
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
