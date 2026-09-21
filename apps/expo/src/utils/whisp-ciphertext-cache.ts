export type CiphertextMessage = { messageId: string; fileUrl: string };
type File = { uri: string; bytes: number };
type Storage = {
  download: (
    url: string,
    signal: AbortSignal,
    byteLimit: () => number | null,
  ) => Promise<File>;
  remove: (uri: string) => Promise<void>;
};
export class CiphertextCacheError extends Error {
  constructor(
    readonly reason: "limit" | "cancelled",
    message: string,
  ) {
    super(message);
  }
}
type Entry = {
  scope: string;
  key: string;
  controller: AbortController;
  readers: number;
  result: Promise<File>;
  state:
    | { kind: "loading" }
    | { kind: "ready"; file: File; expiry: ReturnType<typeof setTimeout> }
    | { kind: "retired" };
};
const MAX_ENTRIES = 3;
const PREFETCH_BYTES = 32 * 1024 * 1024;
const KEEP_MS = 120_000;

function keyFor(message: CiphertextMessage, scope: string) {
  return JSON.stringify([scope, message.messageId, message.fileUrl]);
}
function cancelled() {
  return new CiphertextCacheError(
    "cancelled",
    "The encrypted download was cancelled.",
  );
}

/** Stores only ciphertext, never keys, plaintext, authorization or read receipts. */
export function createCiphertextCache(storage: Storage) {
  const entries = new Map<string, Entry>();
  const versions = new Map<string, number>();
  const version = (scope: string) => versions.get(scope) ?? 0;

  async function retire(entry: Entry) {
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    if (entry.state.kind === "retired") return;
    const state = entry.state;
    entry.state = { kind: "retired" };
    entry.controller.abort();
    if (state.kind === "ready") {
      clearTimeout(state.expiry);
      // A foreground reader owns removal until it finishes decrypting.
      if (entry.readers === 0) await storage.remove(state.file.uri);
    }
  }
  async function makeRoom() {
    if (entries.size < MAX_ENTRIES) return true;
    const oldest = [...entries.values()].find((entry) => entry.readers === 0);
    if (!oldest) return false;
    await retire(oldest);
    return true;
  }
  function start(
    message: CiphertextMessage,
    scope: string,
    foreground: boolean,
  ) {
    const key = keyFor(message, scope);
    const controller = new AbortController();
    const entry: Entry = {
      key,
      scope,
      controller,
      readers: foreground ? 1 : 0,
      state: { kind: "loading" },
      result: Promise.resolve()
        .then(() =>
          storage.download(message.fileUrl, controller.signal, () =>
            entry.readers > 0 ? null : PREFETCH_BYTES,
          ),
        )
        .then(async (file) => {
          if (entry.state.kind === "retired") {
            await storage.remove(file.uri);
            throw new CiphertextCacheError(
              "cancelled",
              "The encrypted download was cancelled.",
            );
          }
          const expiry = setTimeout(() => {
            void retire(entry).catch(reportCleanup);
          }, KEEP_MS);
          entry.state = { kind: "ready", file, expiry };
          return file;
        })
        .catch((error) => {
          if (entries.get(key) === entry) entries.delete(key);
          entry.state = { kind: "retired" };
          throw error;
        }),
    };
    entries.set(key, entry);
    return entry;
  }
  async function acquire(
    message: CiphertextMessage,
    scope: string,
  ): Promise<{ uri: string; release: () => Promise<void> }> {
    const key = keyFor(message, scope);
    const generation = version(scope);
    // Give an explicit open priority over unrelated speculative downloads.
    await Promise.all(
      [...entries.values()]
        .filter(
          (entry) =>
            entry.key !== key &&
            entry.readers === 0 &&
            entry.state.kind === "loading",
        )
        .map(retire),
    );
    if (generation !== version(scope)) throw cancelled();
    let entry = entries.get(key);
    if (entry) entry.readers++;
    else {
      await makeRoom();
      if (generation !== version(scope)) throw cancelled();
      // Another acquisition may have started while cleanup was in flight.
      entry = entries.get(key);
      if (entry) entry.readers++;
      else entry = start(message, scope, true);
    }
    const current = entry;
    let file: File;
    try {
      file = await current.result;
    } catch (error) {
      current.readers--;
      if (generation !== version(scope)) throw cancelled();
      // A speculative size cap must never stop a user from opening a large video.
      if (error instanceof CiphertextCacheError && error.reason === "limit")
        return acquire(message, scope);
      throw error;
    }
    // A ready result can resolve in the same turn as account cleanup. Its
    // retired file was kept for this reader, so release it before rejecting.
    if (generation !== version(scope)) {
      current.readers--;
      if (current.readers === 0) await storage.remove(file.uri);
      throw cancelled();
    }
    let released = false;
    return {
      uri: file.uri,
      release: async () => {
        if (released) return;
        released = true;
        current.readers--;
        if (current.readers === 0) {
          if (current.state.kind === "retired") await storage.remove(file.uri);
          else await retire(current);
        }
      },
    };
  }
  async function prefetch(
    message: CiphertextMessage,
    scope: string,
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) return;
    const generation = version(scope);
    const key = keyFor(message, scope);
    if (entries.has(key)) return;
    if (
      !(await makeRoom()) ||
      entries.has(key) ||
      signal?.aborted ||
      generation !== version(scope) ||
      entries.size >= MAX_ENTRIES
    )
      return;
    const entry = start(message, scope, false);
    const cancel = () => {
      if (entry.readers === 0 && entry.state.kind === "loading")
        void retire(entry).catch(reportCleanup);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      await entry.result;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }
  async function retain(scope: string, messages: CiphertextMessage[]) {
    const wanted = new Set(messages.map((message) => keyFor(message, scope)));
    await Promise.all(
      [...entries.values()]
        .filter(
          (entry) =>
            entry.scope === scope &&
            entry.readers === 0 &&
            !wanted.has(entry.key),
        )
        .map(retire),
    );
  }
  async function clear(scope: string) {
    versions.set(scope, version(scope) + 1);
    await Promise.all(
      [...entries.values()]
        .filter((entry) => entry.scope === scope)
        .map(retire),
    );
  }
  return { acquire, prefetch, retain, clear };
}
function reportCleanup() {
  console.warn(
    "An encrypted prefetch file could not be removed. It will be cleared when Whisp restarts.",
  );
}
