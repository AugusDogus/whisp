import type { MediaKind } from "./media-kind";
import type { QueryClient } from "@tanstack/react-query";

export type { MediaKind } from "./media-kind";

export type OutboxState =
  | "uploading"
  | "retrying"
  | "blocked"
  | "sent"
  | "failed";

export interface OutboxStatus {
  state: OutboxState;
  updatedAtMs: number;
  mediaKind?: MediaKind;
}

type Snapshot = Record<string, OutboxStatus | undefined>;
type Listener = (snapshot: Snapshot) => void;

type Store = {
  statuses: Map<string, OutboxStatus>;
  listeners: Set<Listener>;
};
// QueryProvider creates a fresh client for each account/server session. In-flight
// work and expiry timers retain only their original account's store.
const stores = new WeakMap<QueryClient, Store>();
function storeFor(client: QueryClient): Store {
  let store = stores.get(client);
  if (!store) {
    store = { statuses: new Map(), listeners: new Set() };
    stores.set(client, store);
  }
  return store;
}

function emit({ statuses, listeners }: Store) {
  const snapshot: Snapshot = Object.fromEntries(statuses.entries());
  for (const listener of listeners) listener(snapshot);
}

export function subscribeOutboxStatus(client: QueryClient, listener: Listener) {
  const { listeners } = storeFor(client);
  listeners.add(listener);
  // Immediately send the current snapshot so subscribers render synchronously.
  listener(getOutboxStatusSnapshot(client));
  return () => {
    listeners.delete(listener);
  };
}

export function getOutboxStatusSnapshot(client: QueryClient): Snapshot {
  const { statuses } = storeFor(client);
  return Object.fromEntries(statuses.entries());
}

function setMany(
  client: QueryClient,
  userIds: string[],
  state: OutboxState,
  mediaKind?: MediaKind,
) {
  const store = storeFor(client);
  const { statuses } = store;
  const now = Date.now();
  for (const id of userIds) {
    statuses.set(id, { state, updatedAtMs: now, mediaKind });
  }
  emit(store);
}

function clearManyAfter(
  client: QueryClient,
  userIds: string[],
  delayMs: number,
) {
  const store = storeFor(client);
  const { statuses } = store;
  setTimeout(() => {
    let changed = false;
    for (const id of userIds) {
      // Only clear if it hasn't been updated since we scheduled the clear.
      const s = statuses.get(id);
      if (!s) continue;
      if (Date.now() - s.updatedAtMs < delayMs) continue;
      statuses.delete(id);
      changed = true;
    }
    if (changed) emit(store);
  }, delayMs);
}

export function markWhispUploading(
  client: QueryClient,
  recipientIds: string[],
  mediaKind?: MediaKind,
) {
  setMany(client, recipientIds, "uploading", mediaKind);
}

export function markWhispPending(
  client: QueryClient,
  recipientIds: string[],
  state: "uploading" | "retrying" | "blocked",
  mediaKind: MediaKind,
) {
  setMany(client, recipientIds, state, mediaKind);
}

export function markWhispSent(
  client: QueryClient,
  recipientIds: string[],
  mediaKind?: MediaKind,
) {
  setMany(client, recipientIds, "sent", mediaKind);
  // Give the friends list time to refetch/settle; then stop overriding.
  clearManyAfter(client, recipientIds, 30_000);
}

export function markWhispFailed(client: QueryClient, recipientIds: string[]) {
  setMany(client, recipientIds, "failed");
  clearManyAfter(client, recipientIds, 60_000);
}
