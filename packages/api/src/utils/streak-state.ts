const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MS_PER_HOUR = MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const TWENTY_FOUR_HOURS_MS = HOURS_PER_DAY * MS_PER_HOUR;
const STREAK_DISPLAY_THRESHOLD = 3;

export function calculateStreakUpdate(params: {
  currentStreak: number;
  streakUpdatedAt: Date | null;
  otherLastTimestamp: Date | null;
  now: Date;
}): { newStreak: number; updatedAt: Date | null } {
  const { currentStreak, streakUpdatedAt, otherLastTimestamp, now } = params;
  const todayKey = getUtcDayKey(now);
  const lastCreditedDayKey = getUtcDayKey(streakUpdatedAt);

  if (!otherLastTimestamp || getUtcDayKey(otherLastTimestamp) !== todayKey) {
    return {
      newStreak: currentStreak,
      updatedAt: streakUpdatedAt,
    };
  }

  if (lastCreditedDayKey === todayKey) {
    return {
      newStreak: currentStreak,
      updatedAt: streakUpdatedAt,
    };
  }

  if (
    lastCreditedDayKey !== null &&
    todayKey - lastCreditedDayKey === 1 &&
    currentStreak > 0
  ) {
    return {
      newStreak: currentStreak + 1,
      updatedAt: now,
    };
  }

  return {
    newStreak: 1,
    updatedAt: now,
  };
}

export function deriveDisplayedStreakState(params: {
  currentStreak: number;
  streakUpdatedAt: Date | null;
  myLastActivity: Date | null;
  partnerLastActivity: Date | null;
  now: Date;
}): {
  streak: number;
  shouldShowStreak: boolean;
  bothSentToday: boolean;
  isStreakAtRisk: boolean;
  streakDayEndsAt: Date | null;
  hoursRemaining: number | null;
} {
  const {
    currentStreak,
    streakUpdatedAt,
    myLastActivity,
    partnerLastActivity,
    now,
  } = params;
  const todayKey = getUtcDayKey(now);
  const yesterdayKey = todayKey - 1;
  const lastCreditedDayKey = getUtcDayKey(streakUpdatedAt);
  const isActive =
    lastCreditedDayKey === todayKey || lastCreditedDayKey === yesterdayKey;
  const streak = isActive ? currentStreak : 0;
  const shouldShowStreak = streak >= STREAK_DISPLAY_THRESHOLD;
  const bothSentToday =
    getUtcDayKey(myLastActivity) === todayKey &&
    getUtcDayKey(partnerLastActivity) === todayKey;
  const isStreakAtRisk =
    shouldShowStreak &&
    streak > 0 &&
    lastCreditedDayKey === yesterdayKey &&
    !bothSentToday;
  const streakDayEndsAt = isStreakAtRisk ? getNextUtcMidnight(now) : null;
  const hoursRemaining = streakDayEndsAt
    ? Math.max(streakDayEndsAt.getTime() - now.getTime(), 0) / MS_PER_HOUR
    : null;

  return {
    streak,
    shouldShowStreak,
    bothSentToday,
    isStreakAtRisk,
    streakDayEndsAt,
    hoursRemaining,
  };
}

function getUtcDayKey(date: Date): number;
function getUtcDayKey(date: Date | null): number | null;
function getUtcDayKey(date: Date | null): number | null {
  if (!date) return null;

  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) /
      TWENTY_FOUR_HOURS_MS,
  );
}

function getNextUtcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1),
  );
}
