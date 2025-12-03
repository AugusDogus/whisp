import type { db as Database } from "@acme/db/client";
import { and, eq } from "@acme/db";
import { Friendship } from "@acme/db/schema";

/**
 * Streak System - Expected Behavior
 * ==================================
 *
 * The streak represents consecutive days where BOTH friends have sent messages.
 * A "day" is defined as a 24-hour rolling window from the last activity.
 *
 * Rules:
 * 1. Both users must send at least one message within any 24-hour period to maintain/grow the streak
 * 2. Each user can only contribute ONCE per streak cycle (prevents spam from incrementing streak)
 * 3. The streak increments only when:
 *    - User A sends (after last update)
 *    - User B sends within 24 hours (completes the cycle)
 * 4. The streak resets to 0 if either user fails to send within 24 hours of the other's last message
 * 5. The streak starts at 0 until both users have sent their first message
 *
 * Example Timeline:
 * - Day 1, 10:00 AM: Alice sends → streak stays 0 (waiting for Bob)
 * - Day 1, 2:00 PM:  Bob sends → streak increments to 1 (both participated)
 * - Day 1, 8:00 PM:  Alice sends again → streak stays 1 (already contributed this cycle)
 * - Day 2, 1:00 PM:  Alice sends → streak stays 1 (waiting for Bob to complete next cycle)
 * - Day 2, 5:00 PM:  Bob sends → streak increments to 2 (both participated again)
 * - Day 4, 6:00 PM:  Alice sends → streak resets to 0 (>24h gap since Bob's last message)
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
 * - Checks if conditions are met to increment the streak
 * - Increments streak only if both users have now participated since last update
 * - Resets streak to 0 if there's a gap > 24 hours
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
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  // Determine which user is sending and get their timestamps
  const isSenderA = senderId === userA;
  const senderLastTimestamp = isSenderA
    ? friendship.lastActivityTimestampA
    : friendship.lastActivityTimestampB;
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
    senderLastTimestamp,
    otherLastTimestamp,
    now,
    twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
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

/**
 * Calculates the new streak value based on user activity
 *
 * Expected behavior:
 * - Returns the same streak if conditions aren't met to increment
 * - Returns streak + 1 if this message completes a cycle
 * - Returns 0 if there's a gap that breaks the streak
 * - Returns updatedAt as now if streak increments, null if reset
 */
export function calculateStreakUpdate(params: {
  currentStreak: number;
  streakUpdatedAt: Date | null;
  senderLastTimestamp: Date | null;
  otherLastTimestamp: Date | null;
  now: Date;
  twentyFourHoursMs: number;
}): { newStreak: number; updatedAt: Date | null } {
  const {
    currentStreak,
    streakUpdatedAt,
    senderLastTimestamp,
    otherLastTimestamp,
    now,
    twentyFourHoursMs,
  } = params;

  // Case 1: Other user hasn't sent anything yet
  // Expected: Keep streak at 0, wait for other user to participate
  if (!otherLastTimestamp) {
    return {
      newStreak: currentStreak, // Stay at 0
      updatedAt: null, // No update until both participate
    };
  }

  // Calculate time since other user's last activity
  const timeSinceOther = now.getTime() - otherLastTimestamp.getTime();

  // Case 2: Other user's last activity is > 24 hours ago
  // Expected: Gap detected, reset streak to 0
  if (timeSinceOther > twentyFourHoursMs) {
    return {
      newStreak: 0,
      updatedAt: null, // Clear the update timestamp
    };
  }

  // Case 3: Other user sent within 24 hours (streak is alive)

  // Sub-case 3a: Sender is sending for the first time (no previous timestamp)
  // Expected: Complete the first day, set streak to 1
  if (!senderLastTimestamp) {
    return {
      newStreak: 1,
      updatedAt: now, // Mark when first cycle completed
    };
  }

  // Sub-case 3b: Both users have sent before, check if we should increment

  // Check if other user has sent since the last streak update
  // Expected: If yes, they've done their part for this cycle
  const otherSentSinceUpdate =
    !streakUpdatedAt ||
    otherLastTimestamp.getTime() > streakUpdatedAt.getTime();

  // Check if sender has already sent since the last streak update
  // Expected: If yes, they've already contributed to current cycle
  const senderSentSinceUpdate =
    !streakUpdatedAt ||
    senderLastTimestamp.getTime() > streakUpdatedAt.getTime();

  // Sub-case 3b-i: Other user completed their part, sender hasn't yet
  // Expected: This message completes a new cycle, increment streak
  if (otherSentSinceUpdate && !senderSentSinceUpdate) {
    return {
      newStreak: currentStreak + 1,
      updatedAt: now, // Mark when this cycle completed
    };
  }

  // Sub-case 3b-ii: Either waiting for other user OR sender already contributed
  // Expected: Keep current streak, no changes to update timestamp
  return {
    newStreak: currentStreak,
    updatedAt: streakUpdatedAt, // Keep existing timestamp
  };
}
