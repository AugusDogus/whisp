import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateStreakUpdate,
  deriveDisplayedStreakState,
} from "./streak-state";

function date(value: string): Date {
  return new Date(value);
}

describe("calculateStreakUpdate", () => {
  it("keeps streak at zero until both users send on the same UTC day", () => {
    const result = calculateStreakUpdate({
      currentStreak: 0,
      streakUpdatedAt: null,
      otherLastTimestamp: null,
      now: date("2026-03-10T09:00:00.000Z"),
    });

    assert.equal(result.newStreak, 0);
    assert.equal(result.updatedAt, null);
  });

  it("starts the streak when the second user sends on the same UTC day", () => {
    const result = calculateStreakUpdate({
      currentStreak: 0,
      streakUpdatedAt: null,
      otherLastTimestamp: date("2026-03-10T09:00:00.000Z"),
      now: date("2026-03-10T15:00:00.000Z"),
    });

    assert.equal(result.newStreak, 1);
    assert.equal(result.updatedAt?.toISOString(), "2026-03-10T15:00:00.000Z");
  });

  it("does not double-count a UTC day that was already credited", () => {
    const result = calculateStreakUpdate({
      currentStreak: 2,
      streakUpdatedAt: date("2026-03-11T12:00:00.000Z"),
      otherLastTimestamp: date("2026-03-11T08:00:00.000Z"),
      now: date("2026-03-11T20:00:00.000Z"),
    });

    assert.equal(result.newStreak, 2);
    assert.equal(result.updatedAt?.toISOString(), "2026-03-11T12:00:00.000Z");
  });

  it("increments the streak when the next consecutive UTC day is completed", () => {
    const result = calculateStreakUpdate({
      currentStreak: 2,
      streakUpdatedAt: date("2026-03-11T22:00:00.000Z"),
      otherLastTimestamp: date("2026-03-12T07:00:00.000Z"),
      now: date("2026-03-12T19:00:00.000Z"),
    });

    assert.equal(result.newStreak, 3);
    assert.equal(result.updatedAt?.toISOString(), "2026-03-12T19:00:00.000Z");
  });

  it("restarts at one after a missed UTC day", () => {
    const result = calculateStreakUpdate({
      currentStreak: 5,
      streakUpdatedAt: date("2026-03-10T18:00:00.000Z"),
      otherLastTimestamp: date("2026-03-12T06:00:00.000Z"),
      now: date("2026-03-12T17:00:00.000Z"),
    });

    assert.equal(result.newStreak, 1);
    assert.equal(result.updatedAt?.toISOString(), "2026-03-12T17:00:00.000Z");
  });

  it("respects UTC midnight boundaries", () => {
    const result = calculateStreakUpdate({
      currentStreak: 1,
      streakUpdatedAt: date("2026-03-10T23:30:00.000Z"),
      otherLastTimestamp: date("2026-03-10T23:59:00.000Z"),
      now: date("2026-03-11T00:01:00.000Z"),
    });

    assert.equal(result.newStreak, 1);
    assert.equal(result.updatedAt?.toISOString(), "2026-03-10T23:30:00.000Z");
  });
});

describe("deriveDisplayedStreakState", () => {
  it("hides streaks below the display threshold", () => {
    const result = deriveDisplayedStreakState({
      currentStreak: 2,
      streakUpdatedAt: date("2026-03-12T12:00:00.000Z"),
      myLastActivity: date("2026-03-12T11:00:00.000Z"),
      partnerLastActivity: date("2026-03-12T10:00:00.000Z"),
      now: date("2026-03-12T16:00:00.000Z"),
    });

    assert.equal(result.streak, 2);
    assert.equal(result.shouldShowStreak, false);
    assert.equal(result.isStreakAtRisk, false);
  });

  it("shows streaks at three or above", () => {
    const result = deriveDisplayedStreakState({
      currentStreak: 3,
      streakUpdatedAt: date("2026-03-12T12:00:00.000Z"),
      myLastActivity: date("2026-03-12T11:00:00.000Z"),
      partnerLastActivity: date("2026-03-12T10:00:00.000Z"),
      now: date("2026-03-12T16:00:00.000Z"),
    });

    assert.equal(result.streak, 3);
    assert.equal(result.shouldShowStreak, true);
  });

  it("marks visible streaks as at risk when yesterday was the last credited day", () => {
    const result = deriveDisplayedStreakState({
      currentStreak: 4,
      streakUpdatedAt: date("2026-03-11T20:00:00.000Z"),
      myLastActivity: date("2026-03-11T18:00:00.000Z"),
      partnerLastActivity: date("2026-03-11T19:00:00.000Z"),
      now: date("2026-03-12T21:00:00.000Z"),
    });

    assert.equal(result.streak, 4);
    assert.equal(result.shouldShowStreak, true);
    assert.equal(result.bothSentToday, false);
    assert.equal(result.isStreakAtRisk, true);
    assert.equal(
      result.streakDayEndsAt?.toISOString(),
      "2026-03-13T00:00:00.000Z",
    );
    assert.ok(result.hoursRemaining !== null && result.hoursRemaining <= 3);
  });

  it("treats stale streaks as expired until a new shared day is completed", () => {
    const result = deriveDisplayedStreakState({
      currentStreak: 7,
      streakUpdatedAt: date("2026-03-09T20:00:00.000Z"),
      myLastActivity: date("2026-03-12T09:00:00.000Z"),
      partnerLastActivity: date("2026-03-09T19:00:00.000Z"),
      now: date("2026-03-12T10:00:00.000Z"),
    });

    assert.equal(result.streak, 0);
    assert.equal(result.shouldShowStreak, false);
    assert.equal(result.isStreakAtRisk, false);
    assert.equal(result.streakDayEndsAt, null);
  });
});
