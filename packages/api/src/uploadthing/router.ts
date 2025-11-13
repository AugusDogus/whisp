import type { FileRouter } from "uploadthing/types";
import { createUploadthing, UploadThingError } from "uploadthing/server";
import { z } from "zod/v4";

import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Friendship, Message, MessageDelivery } from "@acme/db/schema";

import { notifyNewMessage } from "../utils/send-notification";

interface CreateDeps {
  getSession: () => Promise<{ user: { id: string } } | null>;
}

/**
 * Updates the streak between two users when a message is sent
 * Streak increments when both users send messages on the same day or consecutive days
 */
async function updateStreak(
  senderId: string,
  recipientId: string,
  today: string,
) {
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

  // Determine which user is sending
  const isSenderA = senderId === userA;
  const senderLastActivity = isSenderA
    ? friendship.lastActivityDateA
    : friendship.lastActivityDateB;
  const otherLastActivity = isSenderA
    ? friendship.lastActivityDateB
    : friendship.lastActivityDateA;

  // If sender already sent today, no need to update
  if (senderLastActivity === today) return;

  // Update sender's last activity date
  const updates: Partial<typeof Friendship.$inferInsert> = {};

  if (isSenderA) {
    updates.lastActivityDateA = today;
  } else {
    updates.lastActivityDateB = today;
  }

  // Calculate new streak
  const currentStreak = friendship.currentStreak;

  if (!otherLastActivity) {
    // Other user hasn't sent yet, keep current streak
    updates.streakUpdatedAt = new Date();
  } else {
    // Both users have activity - check if we should update streak
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // Check if both sent today or if other sent yesterday/today and this completes the streak
    const otherSentToday = otherLastActivity === today;
    const otherSentYesterday = otherLastActivity === yesterdayStr;
    const senderSentYesterday = senderLastActivity === yesterdayStr;

    if (otherSentToday) {
      // Both sent today - increment streak if this is a new day for sender
      if (senderSentYesterday) {
        updates.currentStreak = currentStreak + 1;
      } else if (!senderLastActivity) {
        // First time sender is sending, start streak
        updates.currentStreak = 1;
      } else {
        // Sender's last activity was more than 1 day ago, reset to 1
        updates.currentStreak = 1;
      }
      updates.streakUpdatedAt = new Date();
    } else if (otherSentYesterday && !senderSentYesterday) {
      // Other sent yesterday, sender sending today continues streak
      updates.currentStreak = currentStreak + 1;
      updates.streakUpdatedAt = new Date();
    } else {
      // Gap detected - reset streak
      if (
        senderLastActivity &&
        senderLastActivity !== yesterdayStr &&
        otherLastActivity !== yesterdayStr
      ) {
        updates.currentStreak = 0;
        updates.streakUpdatedAt = new Date();
      }
    }
  }

  // Apply updates
  await db
    .update(Friendship)
    .set(updates)
    .where(and(eq(Friendship.userIdA, userA), eq(Friendship.userIdB, userB)));
}

/**
 * Creates an upload router exposing an authenticated image/video uploader that persists messages, creates deliveries, updates conversation streaks, and notifies recipients.
 *
 * The uploader requires a valid session (throws an UploadThingError with "Unauthorized" when absent), validates input (recipients, optional mimeType and thumbhash), stores a Message and MessageDelivery rows for each recipient, calls updateStreak for each recipient with today's date, and invokes notifyNewMessage per delivery. Metadata returned from the upload handler includes the uploader's user id.
 *
 * @returns A FileRouter object containing an `imageUploader` route that enforces authentication, accepts image/video uploads, persists message and delivery records, updates per-recipient streaks, and dispatches notifications; upload completion returns `{ uploadedBy: <userId> }`.
 */
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
          recipients: z.array(z.string().min(1)).min(1),
          mimeType: z.string().optional(),
          thumbhash: z.string().optional(),
        }),
      )
      .middleware(async ({ input }) => {
        const session = await getSession();
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- UploadThingError maps to proper HTTP status in UploadThing
        if (!session) throw new UploadThingError("Unauthorized");
        return {
          userId: session.user.id,
          recipients: input.recipients,
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

        // Update streak for each recipient
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format
        if (today) {
          for (const recipientId of metadata.recipients) {
            await updateStreak(metadata.userId, recipientId, today);
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