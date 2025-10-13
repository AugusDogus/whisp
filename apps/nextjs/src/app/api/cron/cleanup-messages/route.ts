import { NextResponse } from "next/server";

import { and, inArray, isNotNull, isNull, lt } from "@acme/db";
import { db } from "@acme/db/client";
import { Message, MessageDelivery } from "@acme/db/schema";

import { env } from "~/env";

/**
 * Cleanup old messages that have been soft-deleted for more than 30 days
 * and their associated delivery records.
 *
 * This endpoint is triggered by Vercel Cron (see vercel.json).
 */
export async function GET(request: Request) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Find messages that have been soft-deleted for more than 30 days
    const messagesToDelete = await db
      .select({ id: Message.id })
      .from(Message)
      .where(
        and(isNotNull(Message.deletedAt), lt(Message.deletedAt, thirtyDaysAgo)),
      );

    const messageIds = messagesToDelete.map((m) => m.id);

    let deletedDeliveries = 0;
    let deletedMessages = 0;

    if (messageIds.length > 0) {
      // Delete associated message deliveries first
      const deliveriesResult = await db
        .delete(MessageDelivery)
        .where(inArray(MessageDelivery.messageId, messageIds));

      deletedDeliveries = deliveriesResult.rowsAffected;

      // Then delete the messages themselves
      const messagesResult = await db
        .delete(Message)
        .where(inArray(Message.id, messageIds));

      deletedMessages = messagesResult.rowsAffected;
    }

    // Also clean up very old unread messages (90+ days old)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const oldUnreadMessages = await db
      .select({ id: Message.id })
      .from(Message)
      .where(
        and(
          lt(Message.createdAt, ninetyDaysAgo),
          // Only messages that haven't been soft-deleted yet
          // (if they were soft-deleted, they'll be caught by the 30-day cleanup above)
          isNull(Message.deletedAt),
        ),
      );

    const oldMessageIds = oldUnreadMessages.map((m) => m.id);
    let deletedOldDeliveries = 0;
    let deletedOldMessages = 0;

    if (oldMessageIds.length > 0) {
      // Delete associated message deliveries
      const oldDeliveriesResult = await db
        .delete(MessageDelivery)
        .where(inArray(MessageDelivery.messageId, oldMessageIds));

      deletedOldDeliveries = oldDeliveriesResult.rowsAffected;

      // Delete the old messages
      const oldMessagesResult = await db
        .delete(Message)
        .where(inArray(Message.id, oldMessageIds));

      deletedOldMessages = oldMessagesResult.rowsAffected;
    }

    return NextResponse.json({
      success: true,
      deletedSoftDeletedMessages: deletedMessages,
      deletedSoftDeletedDeliveries: deletedDeliveries,
      deletedOldMessages: deletedOldMessages,
      deletedOldDeliveries: deletedOldDeliveries,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error cleaning up messages:", error);
    return NextResponse.json(
      {
        error: "Failed to cleanup messages",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
