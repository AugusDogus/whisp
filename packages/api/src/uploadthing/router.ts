import type { FileRouter } from "uploadthing/types";
import { createUploadthing, UploadThingError } from "uploadthing/server";
import { z } from "zod/v4";

import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import {
  Friendship,
  GroupMembership,
  Message,
  MessageDelivery,
} from "@acme/db/schema";

import { notifyNewMessage } from "../utils/send-notification";

interface CreateDeps {
  getSession: () => Promise<{ user: { id: string } } | null>;
}

/**
 * Updates the streak between two users when a message is sent
 * Uses 24-hour rolling windows - both users must send within 24 hours of each other
 */
async function updateStreak(senderId: string, recipientId: string) {
  // Normalize the friendship pair (lexicographically sorted)
  const [userA, userB] =
    senderId < recipientId ? [senderId, recipientId] : [recipientId, senderId];

  // Find the friendship
  const [friendship] = await db
    .select()
    .from(Friendship)
    .where(and(eq(Friendship.userIdA, userA), eq(Friendship.userIdB, userB)))
    .limit(1);

  if (!friendship) return;

  const now = new Date();
  const isSenderA = senderId === userA;

  // Get timestamps for both users
  const senderLastTimestamp = isSenderA
    ? friendship.lastActivityTimestampA
    : friendship.lastActivityTimestampB;
  const otherLastTimestamp = isSenderA
    ? friendship.lastActivityTimestampB
    : friendship.lastActivityTimestampA;

  const updates: Partial<typeof Friendship.$inferInsert> = {};

  // Update sender's timestamp
  if (isSenderA) {
    updates.lastActivityTimestampA = now;
  } else {
    updates.lastActivityTimestampB = now;
  }

  const currentStreak = friendship.currentStreak;
  const streakUpdatedAt = friendship.streakUpdatedAt;
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  if (!otherLastTimestamp) {
    // Other user hasn't sent yet - keep streak at 0, just update timestamp
    // Don't set streakUpdatedAt until both have participated
  } else {
    // Check time elapsed since other user's last activity
    const timeSinceOther = now.getTime() - otherLastTimestamp.getTime();

    if (timeSinceOther <= TWENTY_FOUR_HOURS_MS) {
      // Other user sent within last 24 hours - check if we should increment
      if (senderLastTimestamp) {
        // Check if OTHER user has sent since the last streak update
        const otherSentSinceUpdate =
          !streakUpdatedAt ||
          otherLastTimestamp.getTime() > streakUpdatedAt.getTime();

        if (otherSentSinceUpdate) {
          // Both parties have sent since last update - this completes a "day"
          // Increment streak
          updates.currentStreak = currentStreak + 1;
          updates.streakUpdatedAt = now;
        }
        // Otherwise, other user hasn't sent since last update - waiting for next day cycle
      } else {
        // First time sender is sending, and other has already sent - complete first day
        updates.currentStreak = 1;
        updates.streakUpdatedAt = now;
      }
    } else {
      // Gap detected - other user hasn't sent in 24+ hours, reset streak
      updates.currentStreak = 0;
      updates.streakUpdatedAt = null;
    }
  }

  // Apply updates
  await db
    .update(Friendship)
    .set(updates)
    .where(and(eq(Friendship.userIdA, userA), eq(Friendship.userIdB, userB)));
}

export function createUploadRouter({ getSession }: CreateDeps) {
  const f = createUploadthing();

  const uploadRouter = {
    imageUploader: f({
      image: {
        maxFileSize: "4MB",
        maxFileCount: 1,
      },
      video: {
        maxFileSize: "1GB",
        maxFileCount: 1,
      },
    })
      .input(
        z.object({
          recipients: z.array(z.string().min(1)).optional(),
          groupId: z.string().min(1).optional(),
          mimeType: z.string().optional(),
          thumbhash: z.string().optional(),
        }),
      )
      .middleware(async ({ input }) => {
        const session = await getSession();
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- UploadThingError maps to proper HTTP status in UploadThing
        if (!session) throw new UploadThingError("Unauthorized");

        // Validate that either recipients or groupId is provided
        if (!input.recipients && !input.groupId) {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw new UploadThingError(
            "Either recipients or groupId must be provided",
          );
        }

        // If groupId is provided, fetch group members as recipients
        let recipients: string[] = input.recipients ?? [];
        const groupId: string | undefined = input.groupId;

        if (groupId) {
          // Verify user is a member of the group
          const membership = await db
            .select()
            .from(GroupMembership)
            .where(
              and(
                eq(GroupMembership.groupId, groupId),
                eq(GroupMembership.userId, session.user.id),
              ),
            )
            .limit(1);

          if (membership.length === 0) {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw new UploadThingError("Not a member of this group");
          }

          // Get all group members except the sender
          const memberships = await db
            .select()
            .from(GroupMembership)
            .where(eq(GroupMembership.groupId, groupId));

          recipients = memberships
            .map((m) => m.userId)
            .filter((id) => id !== session.user.id);
        }

        return {
          userId: session.user.id,
          recipients,
          groupId,
          mimeType: input.mimeType,
          thumbhash: input.thumbhash,
        };
      })
      .onUploadComplete(async ({ metadata, file }) => {
        // Create message and deliveries
        const messageId = crypto.randomUUID();
        await db.insert(Message).values({
          id: messageId,
          senderId: metadata.userId,
          groupId: metadata.groupId,
          fileUrl: file.ufsUrl,
          fileKey: (file as unknown as { ufsKey?: string }).ufsKey ?? undefined,
          mimeType: metadata.mimeType,
          thumbhash: metadata.thumbhash,
        });

        // Create deliveries and track recipient -> deliveryId mapping
        const deliveries = metadata.recipients.map((rid) => ({
          id: crypto.randomUUID(),
          messageId,
          recipientId: rid,
        }));

        await db.insert(MessageDelivery).values(deliveries);

        // Update streak for each recipient (only for direct messages, not groups)
        if (!metadata.groupId) {
          for (const recipientId of metadata.recipients) {
            await updateStreak(metadata.userId, recipientId);
          }
        }

        // Get sender name for notification
        const sender = await db.query.user.findFirst({
          where: (users, { eq }) => eq(users.id, metadata.userId),
          columns: { name: true },
        });

        // Send notifications to all recipients with their specific deliveryId
        if (sender) {
          for (const delivery of deliveries) {
            void notifyNewMessage(
              db,
              delivery.recipientId,
              metadata.userId,
              sender.name,
              messageId,
              file.ufsUrl,
              metadata.mimeType,
              delivery.id, // Pass the real deliveryId!
              metadata.thumbhash,
            );
          }
        }

        return { uploadedBy: metadata.userId };
      }),
  } satisfies FileRouter;

  return uploadRouter;
}
