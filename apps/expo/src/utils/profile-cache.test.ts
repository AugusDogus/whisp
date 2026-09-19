import type { RouterOutputs } from "./api";
import type { ProfileCacheStorage } from "./profile-cache";

/// <reference lib="es2024.promise" />
import { dehydrate, QueryObserver } from "@tanstack/react-query";
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from "@tanstack/react-query-persist-client";
import { getQueryKey } from "@trpc/react-query";
import { afterEach, expect, test } from "bun:test";

import { createProfileFixture } from "../test/discord-profile";
import { trpc } from "./api";
import {
  createProfileCache,
  createQueryClient,
  PROFILE_CACHE_MAX_AGE,
  PROFILE_STALE_TIME,
} from "./profile-cache";

const friendsKey = getQueryKey(trpc.friends.list, undefined, "query");
const profileKey = getQueryKey(
  trpc.auth.discordProfile,
  { userId: "friend" },
  "query",
);
const clients: ReturnType<typeof createQueryClient>[] = [];
const stops: (() => void)[] = [];
function client() {
  const result = createQueryClient();
  clients.push(result);
  return result;
}
function disk() {
  let value: string | null = null;
  const storage: ProfileCacheStorage = {
    getItem: async () => value,
    setItem: (_key, saved) => {
      value = saved;
    },
    removeItem: () => {
      value = null;
    },
  };
  return {
    storage,
    read: () => value,
    write: (saved: string) => {
      value = saved;
    },
  };
}
function cache(scope: string | null, storage: ProfileCacheStorage) {
  const result = createProfileCache(scope, storage);
  stops.push(result.mount());
  return result;
}
function friend(): RouterOutputs["friends"]["list"][number] {
  const fixture = createProfileFixture();
  fixture.queryClient.clear();
  return {
    id: "friend",
    name: "Fixture Friend",
    image: "saved.png",
    discordId: "123",
    discordProfile: { ...fixture.state.stored, needsRefresh: false },
    streak: 3,
    shouldShowStreak: true,
    bothSentToday: true,
    isStreakAtRisk: false,
    streakDayEndsAt: new Date("2026-09-20T00:00:00Z"),
    lastActivityTimestamp: new Date("2026-09-19T12:00:00Z"),
    partnerLastActivityTimestamp: null,
    lastSentOpened: true,
    lastMimeType: "image/jpeg",
  };
}
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const queryClient of clients.splice(0)) queryClient.clear();
});

test("reopening the friends list reuses fresh data, but invalidation still fetches", async () => {
  const queryClient = client();
  const friends = [friend()];
  queryClient.setQueryData(friendsKey, friends);
  let requests = 0;
  const options = {
    queryKey: friendsKey,
    queryFn: async () => {
      requests++;
      return friends;
    },
  };
  const first = new QueryObserver(queryClient, options);
  first.subscribe(() => {})();
  const reopened = new QueryObserver(queryClient, options);
  const unsubscribe = reopened.subscribe(() => {});
  expect(requests).toBe(0);
  await queryClient.invalidateQueries({ queryKey: friendsKey });
  expect(requests).toBe(1);
  unsubscribe();
});

test("a restart restores fresh profiles and dates without a network request", async () => {
  const storage = disk();
  const saved = client();
  const friends = [friend()];
  saved.setQueryData(friendsKey, friends);
  saved.setQueryData(profileKey, friends[0]?.discordProfile);
  const original = cache("account-a@preview", storage.storage);
  await persistQueryClientSave({ queryClient: saved, ...original.options });
  const restored = client();
  await persistQueryClientRestore({
    queryClient: restored,
    ...cache("account-a@preview", storage.storage).options,
  });
  expect(
    restored.getQueryData<RouterOutputs["friends"]["list"]>(friendsKey),
  ).toEqual(friends);
  expect(
    restored.getQueryData<RouterOutputs["auth"]["discordProfile"]>(profileKey),
  ).toEqual(friends[0]?.discordProfile);
  let requests = 0;
  const result = await restored.fetchQuery<RouterOutputs["friends"]["list"]>({
    queryKey: friendsKey,
    queryFn: async () => {
      requests++;
      return [];
    },
  });
  expect(result).toEqual(friends);
  expect(requests).toBe(0);
});

test("restored stale data remains visible and revalidates", async () => {
  const storage = disk();
  const saved = client();
  const friends = [friend()];
  const updatedAt = Date.now() - PROFILE_STALE_TIME - 100;
  saved.setQueryData(friendsKey, friends, { updatedAt });
  await persistQueryClientSave({
    queryClient: saved,
    ...cache("account-a", storage.storage).options,
  });
  const restored = client();
  await persistQueryClientRestore({
    queryClient: restored,
    ...cache("account-a", storage.storage).options,
  });
  expect(
    restored.getQueryData<RouterOutputs["friends"]["list"]>(friendsKey),
  ).toEqual(friends);
  expect(restored.getQueryState(friendsKey)?.dataUpdatedAt).toBe(updatedAt);
  let requests = 0;
  await restored.fetchQuery<RouterOutputs["friends"]["list"]>({
    queryKey: friendsKey,
    queryFn: async () => {
      requests++;
      return [];
    },
  });
  expect(requests).toBe(1);
});

test.each(["account-b@preview", "account-a@production", null])(
  "a different scope or sign-out discards the saved account (%s)",
  async (scope) => {
    const storage = disk();
    const saved = client();
    saved.setQueryData(friendsKey, [friend()]);
    await persistQueryClientSave({
      queryClient: saved,
      ...cache("account-a@preview", storage.storage).options,
    });
    const restored = client();
    await persistQueryClientRestore({
      queryClient: restored,
      ...cache(scope, storage.storage).options,
    });
    expect(
      restored.getQueryData<RouterOutputs["friends"]["list"]>(friendsKey),
    ).toBeUndefined();
    expect(storage.read()).toBeNull();
  },
);

test("messages, auth data, mutations and queries without successful data are excluded", async () => {
  const storage = disk();
  const saved = client();
  saved.setQueryData(friendsKey, [friend()]);
  await expect(
    saved.fetchQuery({
      queryKey: profileKey,
      queryFn: async () => {
        throw new Error("Offline without cached data");
      },
      retry: false,
    }),
  ).rejects.toThrow("Offline without cached data");
  saved.setQueryData(
    [["messages", "inbox"], { type: "query" }],
    "private-message",
  );
  saved.setQueryData(
    [["auth", "getSession"], { type: "query" }],
    "session-secret",
  );
  saved.getMutationCache().build(saved, { mutationKey: ["private-mutation"] });
  await persistQueryClientSave({
    queryClient: saved,
    ...cache("account-a", storage.storage).options,
  });
  expect(storage.read()).not.toContain("private-message");
  expect(storage.read()).not.toContain("session-secret");
  expect(storage.read()).not.toContain("private-mutation");
  const restored = client();
  await persistQueryClientRestore({
    queryClient: restored,
    ...cache("account-a", storage.storage).options,
  });
  expect(restored.getQueryCache().getAll()).toHaveLength(1);
  expect(restored.getMutationCache().getAll()).toHaveLength(0);
});

test("invalidation survives an app restart", async () => {
  const storage = disk();
  const saved = client();
  saved.setQueryData(friendsKey, [friend()]);
  await saved.invalidateQueries({ queryKey: friendsKey, refetchType: "none" });
  await persistQueryClientSave({
    queryClient: saved,
    ...cache("account-a", storage.storage).options,
  });
  const restored = client();
  await persistQueryClientRestore({
    queryClient: restored,
    ...cache("account-a", storage.storage).options,
  });
  let requests = 0;
  await restored.fetchQuery<RouterOutputs["friends"]["list"]>({
    queryKey: friendsKey,
    queryFn: async () => {
      requests++;
      return [];
    },
  });
  expect(requests).toBe(1);
});

test("an individual entry expires even if another query caused a newer snapshot", async () => {
  const storage = disk();
  const saved = client();
  saved.setQueryData(friendsKey, [friend()], {
    updatedAt: Date.now() - PROFILE_CACHE_MAX_AGE - 100,
  });
  const original = cache("account-a", storage.storage);
  await original.options.persister.persistClient({
    timestamp: Date.now(),
    buster: original.options.buster ?? "",
    clientState: dehydrate(saved),
  });
  const restored = client();
  await persistQueryClientRestore({
    queryClient: restored,
    ...cache("account-a", storage.storage).options,
  });
  expect(
    restored.getQueryData<RouterOutputs["friends"]["list"]>(friendsKey),
  ).toBeUndefined();
});

test("malformed cached data is rejected and removed", async () => {
  const storage = disk();
  const saved = client();
  saved.setQueryData(friendsKey, { not: "a friends list" });
  await persistQueryClientSave({
    queryClient: saved,
    ...cache("account-a", storage.storage).options,
  });
  const restored = client();
  await expect(
    persistQueryClientRestore({
      queryClient: restored,
      ...cache("account-a", storage.storage).options,
    }),
  ).rejects.toBeDefined();
  expect(restored.getQueryCache().getAll()).toHaveLength(0);
  expect(storage.read()).toBeNull();
});

test("disposing an account cancels delayed cache reads and writes", async () => {
  const storage = disk();
  const saved = client();
  saved.setQueryData(friendsKey, [friend()]);
  const original = cache("account-a", storage.storage);
  await persistQueryClientSave({ queryClient: saved, ...original.options });
  const read = Promise.withResolvers<string | null>();
  const oldAccount = createProfileCache("account-a", {
    ...storage.storage,
    getItem: () => read.promise,
  });
  const stop = oldAccount.mount();
  const restoring = oldAccount.options.persister.restoreClient();
  const writing = persistQueryClientSave({
    queryClient: saved,
    ...oldAccount.options,
  });
  stop();
  const previous = storage.read();
  storage.write("new-account-cache");
  read.resolve(previous);
  await writing;
  expect(await restoring).toBeUndefined();
  expect(storage.read()).toBe("new-account-cache");
});
