export type OutboxState = "uploading" | "sent" | "failed";

export interface OutboxStatus {
  state: OutboxState;
  updatedAtMs: number;
}

type Snapshot = Record<string, OutboxStatus | undefined>;
type Listener = (snapshot: Snapshot) => void;

const statuses = new Map<string, OutboxStatus>();
const listeners = new Set<Listener>();

function emit() {
  const snapshot: Snapshot = Object.fromEntries(statuses.entries());
  for (const listener of listeners) listener(snapshot);
}

export function subscribeOutboxStatus(listener: Listener) {
  listeners.add(listener);
  // Immediately send the current snapshot so subscribers render synchronously.
  listener(getOutboxStatusSnapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function getOutboxStatusSnapshot(): Snapshot {
  return Object.fromEntries(statuses.entries());
}

function setMany(userIds: string[], state: OutboxState) {
  const now = Date.now();
  for (const id of userIds) {
    statuses.set(id, { state, updatedAtMs: now });
  }
  emit();
}

function clearManyAfter(userIds: string[], delayMs: number) {
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
    if (changed) emit();
  }, delayMs);
}

export function markWhispUploading(recipientIds: string[]) {
  setMany(recipientIds, "uploading");
}

export function markWhispSent(recipientIds: string[]) {
  setMany(recipientIds, "sent");
  // Give the friends list time to refetch/settle; then stop overriding.
  clearManyAfter(recipientIds, 30_000);
}

export function markWhispFailed(recipientIds: string[]) {
  setMany(recipientIds, "failed");
  clearManyAfter(recipientIds, 60_000);
}
