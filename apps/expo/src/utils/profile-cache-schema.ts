import type { PersistedClient } from "@tanstack/react-query-persist-client";

import { hashKey } from "@tanstack/react-query";
import superjson from "superjson";
import { z } from "zod/v4";

import type { RouterOutputs } from "@acme/api";

const profile = z.object({
  needsRefresh: z.boolean(),
  profile: z.object({
    name: z.string(),
    username: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    cosmetics: z
      .object({
        bannerUrl: z.string().nullable(),
        accentColor: z.string().nullable(),
        decorationUrl: z.string().nullable(),
        guildTag: z
          .object({ tag: z.string(), badgeUrl: z.string().nullable() })
          .nullable(),
        nameplateUrl: z.string().nullable(),
        badges: z.array(z.string()),
        lastSyncedAt: z.number().finite(),
      })
      .nullable(),
  }),
}) satisfies z.ZodType<RouterOutputs["auth"]["discordProfile"]>;

const friends = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    image: z.string().nullable(),
    discordId: z.string().nullable(),
    discordProfile: profile,
    streak: z.number(),
    shouldShowStreak: z.boolean(),
    bothSentToday: z.boolean(),
    isStreakAtRisk: z.boolean(),
    streakDayEndsAt: z.date().nullable(),
    lastActivityTimestamp: z.date().nullable(),
    partnerLastActivityTimestamp: z.date().nullable(),
    lastSentOpened: z.boolean().nullable(),
    lastMimeType: z.string().nullable(),
  }),
) satisfies z.ZodType<RouterOutputs["friends"]["list"]>;

const savedState = z.object({
  dataUpdatedAt: z.number().finite().nonnegative(),
  isInvalidated: z.boolean(),
});
const savedQuery = z.union([
  z.object({
    queryKey: z.tuple([
      z.tuple([z.literal("friends"), z.literal("list")]),
      z.object({ type: z.literal("query") }),
    ]),
    state: savedState.extend({ data: friends }),
  }),
  z.object({
    queryKey: z.tuple([
      z.tuple([z.literal("auth"), z.literal("discordProfile")]),
      z.object({
        type: z.literal("query"),
        input: z.object({ userId: z.string() }),
      }),
    ]),
    state: savedState.extend({ data: profile }),
  }),
]);
const snapshot = z.object({
  buster: z.string(),
  timestamp: z.number().finite().nonnegative(),
  clientState: z.object({ queries: z.array(savedQuery) }),
});

export function serializeProfileCache(client: PersistedClient): string {
  return superjson.stringify({
    ...client,
    clientState: {
      ...client.clientState,
      queries: client.clientState.queries.map((query) => ({
        ...query,
        state: {
          ...query.state,
          // Keep the last successful data without persisting request errors.
          // Retry a failed refresh even when the saved data is under five minutes old.
          isInvalidated:
            query.state.isInvalidated || query.state.status === "error",
          error: null,
          fetchFailureReason: null,
        },
      })),
    },
  });
}

export function deserializeProfileCache(value: string): PersistedClient {
  const saved = snapshot.parse(superjson.parse<unknown>(value));
  return {
    buster: saved.buster,
    timestamp: saved.timestamp,
    clientState: {
      mutations: [],
      queries: saved.clientState.queries.map(({ queryKey, state }) => ({
        queryKey,
        queryHash: hashKey(queryKey),
        state: {
          ...state,
          dataUpdateCount: 1,
          error: null,
          errorUpdateCount: 0,
          errorUpdatedAt: 0,
          fetchFailureCount: 0,
          fetchFailureReason: null,
          fetchMeta: null,
          status: "success",
          fetchStatus: "idle",
        },
      })),
    },
  };
}
