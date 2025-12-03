/**
 * Comprehensive Unit Tests for update-streak.ts
 * ==============================================
 * 
 * Tests the streak calculation logic for the friendship streak system.
 * Run with: node --test --experimental-strip-types packages/api/src/utils/__tests__/update-streak.test.ts
 * 
 * Or add to package.json: "test": "node --test --experimental-strip-types src/**/*.test.ts"
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateStreakUpdate } from "../update-streak.js";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

describe("calculateStreakUpdate - Pure Function Tests", () => {
  describe("Case 1: Other user hasn't sent anything yet", () => {
    it("should keep streak at 0 when other user has never sent", () => {
      const now = new Date("2024-01-01T14:00:00Z");
      const result = calculateStreakUpdate({
        currentStreak: 0,
        streakUpdatedAt: null,
        senderLastTimestamp: new Date("2024-01-01T10:00:00Z"),
        otherLastTimestamp: null, // Other user hasn't sent
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 0, "Streak should stay at 0");
      assert.equal(result.updatedAt, null, "updatedAt should be null");
    });

    it("should keep current streak unchanged when other user hasn't sent", () => {
      const now = new Date("2024-01-01T14:00:00Z");
      const result = calculateStreakUpdate({
        currentStreak: 5, // Any existing streak
        streakUpdatedAt: new Date("2024-01-01T08:00:00Z"),
        senderLastTimestamp: new Date("2024-01-01T10:00:00Z"),
        otherLastTimestamp: null,
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 5, "Should maintain current streak");
      assert.equal(result.updatedAt, null);
    });
  });

  describe("Case 2: Gap exceeds 24 hours - streak reset", () => {
    it("should reset streak to 0 when exactly 24h + 1ms has passed", () => {
      const otherTimestamp = new Date("2024-01-01T14:00:00.000Z");
      const now = new Date(otherTimestamp.getTime() + TWENTY_FOUR_HOURS_MS + 1);

      const result = calculateStreakUpdate({
        currentStreak: 5,
        streakUpdatedAt: new Date("2024-01-01T14:00:00Z"),
        senderLastTimestamp: new Date("2024-01-01T10:00:00Z"),
        otherLastTimestamp: otherTimestamp,
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 0, "Streak should reset to 0");
      assert.equal(result.updatedAt, null, "updatedAt should be cleared");
    });

    it("should reset high streak when gap exceeds 24 hours", () => {
      const otherTimestamp = new Date("2024-01-01T14:00:00Z");
      const now = new Date("2024-01-03T15:00:00Z"); // 49 hours later

      const result = calculateStreakUpdate({
        currentStreak: 50,
        streakUpdatedAt: new Date("2024-01-01T14:00:00Z"),
        senderLastTimestamp: new Date("2024-01-01T10:00:00Z"),
        otherLastTimestamp: otherTimestamp,
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 0);
      assert.equal(result.updatedAt, null);
    });

    it("should NOT reset streak at exactly 24 hours", () => {
      const otherTimestamp = new Date("2024-01-01T14:00:00.000Z");
      const now = new Date(otherTimestamp.getTime() + TWENTY_FOUR_HOURS_MS); // Exactly 24h

      const result = calculateStreakUpdate({
        currentStreak: 5,
        streakUpdatedAt: new Date("2024-01-01T14:00:00Z"),
        senderLastTimestamp: new Date("2024-01-01T10:00:00Z"),
        otherLastTimestamp: otherTimestamp,
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.notEqual(result.newStreak, 0, "Should not reset at exactly 24h");
      assert.equal(result.newStreak, 5, "Should maintain streak");
    });
  });

  describe("Case 3a: First cycle completion", () => {
    it("should set streak to 1 when sender sends for first time", () => {
      const now = new Date("2024-01-01T14:00:00Z");
      const result = calculateStreakUpdate({
        currentStreak: 0,
        streakUpdatedAt: null,
        senderLastTimestamp: null, // Sender's first message
        otherLastTimestamp: new Date("2024-01-01T10:00:00Z"), // Other user already sent
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 1, "Should increment to 1");
      assert.deepEqual(result.updatedAt, now, "Should set updatedAt to now");
    });

    it("should set streak to 1 when other user sent within 24 hours", () => {
      const now = new Date("2024-01-01T23:59:59Z");
      const otherTimestamp = new Date("2024-01-01T00:00:01Z");

      const result = calculateStreakUpdate({
        currentStreak: 0,
        streakUpdatedAt: null,
        senderLastTimestamp: null,
        otherLastTimestamp: otherTimestamp,
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 1);
      assert.deepEqual(result.updatedAt, now);
    });
  });

  describe("Case 3b-i: Streak increment - cycle completion", () => {
    it("should increment streak when other sent since update but sender hasn't", () => {
      const now = new Date("2024-01-02T16:00:00Z");
      const lastUpdate = new Date("2024-01-01T14:00:00Z");
      const otherTimestamp = new Date("2024-01-02T14:00:00Z"); // After last update
      const senderTimestamp = new Date("2024-01-01T10:00:00Z"); // Before last update

      const result = calculateStreakUpdate({
        currentStreak: 1,
        streakUpdatedAt: lastUpdate,
        senderLastTimestamp: senderTimestamp,
        otherLastTimestamp: otherTimestamp,
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 2, "Should increment streak");
      assert.deepEqual(result.updatedAt, now, "Should update timestamp");
    });

    it("should increment from high streak values correctly", () => {
      const now = new Date("2024-01-15T16:00:00Z");
      const lastUpdate = new Date("2024-01-14T14:00:00Z");
      const otherTimestamp = new Date("2024-01-15T14:00:00Z");
      const senderTimestamp = new Date("2024-01-14T10:00:00Z");

      const result = calculateStreakUpdate({
        currentStreak: 99,
        streakUpdatedAt: lastUpdate,
        senderLastTimestamp: senderTimestamp,
        otherLastTimestamp: otherTimestamp,
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 100);
      assert.deepEqual(result.updatedAt, now);
    });

    it("should increment when streakUpdatedAt is null and other has timestamp", () => {
      const now = new Date("2024-01-02T16:00:00Z");
      const otherTimestamp = new Date("2024-01-02T14:00:00Z");
      const senderTimestamp = new Date("2024-01-01T10:00:00Z");

      const result = calculateStreakUpdate({
        currentStreak: 1,
        streakUpdatedAt: null, // No previous update
        senderLastTimestamp: senderTimestamp,
        otherLastTimestamp: otherTimestamp,
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 2, "Should increment with null updatedAt");
    });
  });

  describe("Case 3b-ii: Streak maintenance - no increment", () => {
    it("should NOT increment if sender already contributed this cycle", () => {
      const now = new Date("2024-01-01T20:00:00Z");
      const lastUpdate = new Date("2024-01-01T14:00:00Z");
      const senderTimestamp = new Date("2024-01-01T15:00:00Z"); // After last update
      const otherTimestamp = new Date("2024-01-01T14:00:00Z");

      const result = calculateStreakUpdate({
        currentStreak: 1,
        streakUpdatedAt: lastUpdate,
        senderLastTimestamp: senderTimestamp,
        otherLastTimestamp: otherTimestamp,
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 1, "Should maintain streak");
      assert.deepEqual(result.updatedAt, lastUpdate, "Should keep original updatedAt");
    });

    it("should NOT increment if waiting for other user to contribute", () => {
      const now = new Date("2024-01-02T10:00:00Z");
      const lastUpdate = new Date("2024-01-01T14:00:00Z");
      const senderTimestamp = new Date("2024-01-01T15:00:00Z");
      const otherTimestamp = new Date("2024-01-01T12:00:00Z"); // Before last update

      const result = calculateStreakUpdate({
        currentStreak: 1,
        streakUpdatedAt: lastUpdate,
        senderLastTimestamp: senderTimestamp,
        otherLastTimestamp: otherTimestamp,
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 1, "Should wait for other user");
      assert.deepEqual(result.updatedAt, lastUpdate);
    });

    it("should NOT increment when both sent before last update", () => {
      const now = new Date("2024-01-02T10:00:00Z");
      const lastUpdate = new Date("2024-01-01T14:00:00Z");
      const senderTimestamp = new Date("2024-01-01T10:00:00Z");
      const otherTimestamp = new Date("2024-01-01T12:00:00Z");

      const result = calculateStreakUpdate({
        currentStreak: 1,
        streakUpdatedAt: lastUpdate,
        senderLastTimestamp: senderTimestamp,
        otherLastTimestamp: otherTimestamp,
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 1);
      assert.deepEqual(result.updatedAt, lastUpdate);
    });
  });

  describe("Documentation timeline example", () => {
    it("should follow complete example from documentation", () => {
      const twentyFourHours = TWENTY_FOUR_HOURS_MS;
      
      // Day 1, 10:00 AM: Alice sends → streak stays 0 (waiting for Bob)
      const step1Time = new Date("2024-01-01T10:00:00Z");
      const step1 = calculateStreakUpdate({
        currentStreak: 0,
        streakUpdatedAt: null,
        senderLastTimestamp: null, // Alice's first message
        otherLastTimestamp: null, // Bob hasn't sent yet
        now: step1Time,
        twentyFourHoursMs: twentyFourHours,
      });
      assert.equal(step1.newStreak, 0, "Step 1: Streak should stay 0");
      assert.equal(step1.updatedAt, null);

      // Day 1, 2:00 PM: Bob sends → streak increments to 1 (both participated)
      const step2Time = new Date("2024-01-01T14:00:00Z");
      const step2 = calculateStreakUpdate({
        currentStreak: 0,
        streakUpdatedAt: null,
        senderLastTimestamp: null, // Bob's first message
        otherLastTimestamp: step1Time, // Alice sent at 10:00 AM
        now: step2Time,
        twentyFourHoursMs: twentyFourHours,
      });
      assert.equal(step2.newStreak, 1, "Step 2: Streak should be 1");
      assert.deepEqual(step2.updatedAt, step2Time);

      // Day 1, 8:00 PM: Alice sends again → streak stays 1 (already contributed)
      const step3Time = new Date("2024-01-01T20:00:00Z");
      const step3 = calculateStreakUpdate({
        currentStreak: 1,
        streakUpdatedAt: step2Time,
        senderLastTimestamp: step1Time, // Alice last sent at 10:00 AM (before update)
        otherLastTimestamp: step2Time, // Bob sent at 2:00 PM
        now: step3Time,
        twentyFourHoursMs: twentyFourHours,
      });
      assert.equal(step3.newStreak, 1, "Step 3: Streak should stay 1");

      // Day 2, 1:00 PM: Alice sends → streak stays 1 (waiting for Bob)
      const step4Time = new Date("2024-01-02T13:00:00Z");
      const step4 = calculateStreakUpdate({
        currentStreak: 1,
        streakUpdatedAt: step2Time,
        senderLastTimestamp: step3Time, // Alice sent at 8:00 PM (after update)
        otherLastTimestamp: step2Time, // Bob last sent at 2:00 PM Day 1 (before this cycle)
        now: step4Time,
        twentyFourHoursMs: twentyFourHours,
      });
      assert.equal(step4.newStreak, 1, "Step 4: Streak should stay 1, waiting for Bob");

      // Day 2, 5:00 PM: Bob sends → streak increments to 2 (both participated)
      const step5Time = new Date("2024-01-02T17:00:00Z");
      const step5 = calculateStreakUpdate({
        currentStreak: 1,
        streakUpdatedAt: step2Time,
        senderLastTimestamp: step2Time, // Bob last sent at Day 1 2:00 PM (before update)
        otherLastTimestamp: step4Time, // Alice sent at 1:00 PM (after update)
        now: step5Time,
        twentyFourHoursMs: twentyFourHours,
      });
      assert.equal(step5.newStreak, 2, "Step 5: Streak should be 2");
      assert.deepEqual(step5.updatedAt, step5Time);

      // Day 4, 6:00 PM: Alice sends → streak resets to 0 (>24h gap since Bob)
      const step6Time = new Date("2024-01-04T18:00:00Z");
      const step6 = calculateStreakUpdate({
        currentStreak: 2,
        streakUpdatedAt: step5Time,
        senderLastTimestamp: step4Time, // Alice last sent Day 2 1:00 PM
        otherLastTimestamp: step5Time, // Bob last sent Day 2 5:00 PM
        now: step6Time,
        twentyFourHoursMs: twentyFourHours,
      });
      assert.equal(step6.newStreak, 0, "Step 6: Streak should reset to 0");
      assert.equal(step6.updatedAt, null);
    });
  });

  describe("Edge cases", () => {
    it("should handle millisecond-precise timestamps", () => {
      const baseTime = new Date("2024-01-01T14:00:00.123Z");
      const now = new Date("2024-01-01T14:00:00.456Z");

      const result = calculateStreakUpdate({
        currentStreak: 1,
        streakUpdatedAt: baseTime,
        senderLastTimestamp: new Date(baseTime.getTime() - 1000),
        otherLastTimestamp: baseTime,
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.ok(result.newStreak !== undefined, "Should handle milliseconds");
    });

    it("should handle epoch timestamps", () => {
      const now = new Date(1000000);
      const result = calculateStreakUpdate({
        currentStreak: 0,
        streakUpdatedAt: null,
        senderLastTimestamp: null,
        otherLastTimestamp: new Date(0),
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 1, "Should handle epoch times");
    });

    it("should handle very large streak numbers", () => {
      const now = new Date("2024-01-15T16:00:00Z");
      const result = calculateStreakUpdate({
        currentStreak: 99999,
        streakUpdatedAt: new Date("2024-01-14T14:00:00Z"),
        senderLastTimestamp: new Date("2024-01-14T10:00:00Z"),
        otherLastTimestamp: new Date("2024-01-15T14:00:00Z"),
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 100000, "Should handle large numbers");
    });

    it("should handle timestamp equality edge cases", () => {
      const exactTime = new Date("2024-01-01T14:00:00Z");
      const result = calculateStreakUpdate({
        currentStreak: 1,
        streakUpdatedAt: exactTime,
        senderLastTimestamp: exactTime,
        otherLastTimestamp: exactTime,
        now: new Date("2024-01-02T10:00:00Z"),
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.ok(typeof result.newStreak === "number", "Should handle equal timestamps");
    });
  });

  describe("Boolean logic coverage", () => {
    it("should handle otherSentSinceUpdate=true, senderSentSinceUpdate=true", () => {
      const now = new Date("2024-01-02T10:00:00Z");
      const lastUpdate = new Date("2024-01-01T14:00:00Z");

      const result = calculateStreakUpdate({
        currentStreak: 1,
        streakUpdatedAt: lastUpdate,
        senderLastTimestamp: new Date("2024-01-01T16:00:00Z"), // After update
        otherLastTimestamp: new Date("2024-01-01T15:00:00Z"), // After update
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 1, "Both sent, should not increment");
    });

    it("should handle otherSentSinceUpdate=false, senderSentSinceUpdate=false", () => {
      const now = new Date("2024-01-02T10:00:00Z");
      const lastUpdate = new Date("2024-01-01T14:00:00Z");

      const result = calculateStreakUpdate({
        currentStreak: 1,
        streakUpdatedAt: lastUpdate,
        senderLastTimestamp: new Date("2024-01-01T10:00:00Z"), // Before update
        otherLastTimestamp: new Date("2024-01-01T12:00:00Z"), // Before update
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 1, "Neither sent since update, maintain");
    });

    it("should handle otherSentSinceUpdate=false, senderSentSinceUpdate=true", () => {
      const now = new Date("2024-01-02T10:00:00Z");
      const lastUpdate = new Date("2024-01-01T14:00:00Z");

      const result = calculateStreakUpdate({
        currentStreak: 1,
        streakUpdatedAt: lastUpdate,
        senderLastTimestamp: new Date("2024-01-01T16:00:00Z"), // After update
        otherLastTimestamp: new Date("2024-01-01T12:00:00Z"), // Before update
        now,
        twentyFourHoursMs: TWENTY_FOUR_HOURS_MS,
      });

      assert.equal(result.newStreak, 1, "Waiting for other user");
    });
  });
});

console.log("✓ All calculateStreakUpdate tests completed");