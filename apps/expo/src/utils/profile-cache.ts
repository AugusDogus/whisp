import type { PersistQueryClientProviderProps } from "@tanstack/react-query-persist-client";

import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";

import {
  deserializeProfileCache,
  serializeProfileCache,
} from "./profile-cache-schema";

export const PROFILE_STALE_TIME = 5 * 60 * 1000;
export const PROFILE_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
const friendsKey = [["friends", "list"]] as const;
const profileKey = [["auth", "discordProfile"]] as const;

export function createQueryClient() {
  const client = new QueryClient();
  for (const key of [friendsKey, profileKey]) {
    client.setQueryDefaults(key, {
      staleTime: PROFILE_STALE_TIME,
      gcTime: PROFILE_CACHE_MAX_AGE,
    });
  }
  return client;
}

export interface ProfileCacheStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export function createProfileCache(
  scope: string | null,
  storage: ProfileCacheStorage,
) {
  let active = true;
  const persister = createAsyncStoragePersister({
    storage: {
      getItem: async (key) => {
        if (!active) return null;
        if (scope === null) {
          storage.removeItem(key);
          return null;
        }
        const saved = await storage.getItem(key);
        return active ? saved : null;
      },
      setItem: (key, value) => {
        if (active && scope !== null) storage.setItem(key, value);
      },
      removeItem: (key) => {
        if (active) storage.removeItem(key);
      },
    },
    key: "profiles-v1",
    serialize: serializeProfileCache,
    deserialize: deserializeProfileCache,
    retry: ({ error }) => {
      console.warn(
        "Could not save the profile cache; current in-memory data is unchanged",
        error,
      );
      return undefined;
    },
  });
  const options: PersistQueryClientProviderProps["persistOptions"] = {
    persister,
    buster: JSON.stringify([1, scope]),
    maxAge: PROFILE_CACHE_MAX_AGE,
    dehydrateOptions: {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: (query) =>
        scope !== null &&
        query.state.data !== undefined &&
        Date.now() - query.state.dataUpdatedAt < PROFILE_CACHE_MAX_AGE &&
        [friendsKey, profileKey].some(
          (key) => JSON.stringify(query.queryKey[0]) === JSON.stringify(key[0]),
        ),
    },
  };
  const restore = persister.restoreClient;
  persister.restoreClient = async () => {
    const saved = await restore();
    if (!active || !saved) return undefined;
    // Unrelated writes must not extend the lifetime of old profile entries.
    saved.clientState.queries = saved.clientState.queries.filter(
      (query) => Date.now() - query.state.dataUpdatedAt < PROFILE_CACHE_MAX_AGE,
    );
    return saved;
  };
  return {
    options,
    mount: () => {
      active = true;
      return () => {
        active = false;
      };
    },
  };
}
