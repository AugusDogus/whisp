import { and, eq } from "@acme/db";
import type { db as Database } from "@acme/db/client";
import { Friendship } from "@acme/db/schema";

import { calculateStreakUpdate } from "./streak-state";

/**
 * Streak System - Expected Behavior
 * ==================================
 *
 * The streak represents consecutive UTC days where BOTH friends have sent
 * at least one direct message.
 *
 * Rules:
 * 1. A UTC day counts only when both users send at least once that day.
 * 2. Each UTC day can increase the streak at most once.
 * 3. Repeated sends by the same user on the same day never double-count.
 * 4. Missing a UTC day breaks the streak; the next shared day restarts at 1.
 * 5. The streak is tracked internally from day 1, but the UI should only
 *    display it once it reaches 3.
 *
 * Example Timeline:
 * - 2026-03-10 09:00 UTC: Alice sends → streak stays 0 (waiting for Bob)
 * - 2026-03-10 15:00 UTC: Bob sends   → streak becomes 1
 * - 2026-03-10 20:00 UTC: Alice sends → streak stays 1 (day already counted)
 * - 2026-03-11 18:00 UTC: Bob sends   → streak stays 1 (waiting for Alice)
 * - 2026-03-11 22:00 UTC: Alice sends → streak becomes 2
 * - 2026-03-13 12:00 UTC: Bob sends   → streak still appears expired until
 *   Alice also sends on 2026-03-13, at which point it restarts at 1
 */

/**
 * Updates the friendship streak when a user sends a message
 *
 * @param db - Database instance
 * @param senderId - ID of the user sending the message
 * @param recipientId - ID of the user receiving the message
 *
 * Expected behavior:
 * - Updates the sender's last activity timestamp
 * - Checks if both users have now sent on the current UTC day
 * - Credits the UTC day once, even if one user sends repeatedly
 * - Increments the streak only when the newly credited day follows the
 *   previous credited UTC day
 * - Restarts at 1 when the newly credited day follows a missed UTC day
 */
export async function updateStreak(
  db: typeof Database,
  senderId: string,
  recipientId: string,
) {
  // Normalize the friendship pair (stored lexicographically sorted)
  const [userA, userB] =
    senderId < recipientId ? [senderId, recipientId] : [recipientId, senderId];

  // Find the friendship record
  const [friendship] = await db
    .select()
    .from(Friendship)
    .where(and(eq(Friendship.userIdA, userA), eq(Friendship.userIdB, userB)))
    .limit(1);

  if (!friendship) return;

  const now = new Date();

  // Determine which user is sending and get their timestamps
  const isSenderA = senderId === userA;
  const otherLastTimestamp = isSenderA
    ? friendship.lastActivityTimestampB
    : friendship.lastActivityTimestampA;

  // Prepare update object
  const updates: Partial<typeof Friendship.$inferInsert> = {};

  // Always update sender's activity timestamp
  if (isSenderA) {
    updates.lastActivityTimestampA = now;
  } else {
    updates.lastActivityTimestampB = now;
  }

  // Calculate streak updates based on both users' activity
  const streakUpdate = calculateStreakUpdate({
    currentStreak: friendship.currentStreak,
    streakUpdatedAt: friendship.streakUpdatedAt,
    otherLastTimestamp,
    now,
  });

  // Apply streak updates
  updates.currentStreak = streakUpdate.newStreak;
  updates.streakUpdatedAt = streakUpdate.updatedAt;

  // Persist changes to database
  await db
    .update(Friendship)
    .set(updates)
    .where(and(eq(Friendship.userIdA, userA), eq(Friendship.userIdB, userB)));
}
