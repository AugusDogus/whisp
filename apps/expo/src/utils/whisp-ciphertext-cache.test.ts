/// <reference lib="es2024.promise" />
import { expect, test } from "bun:test";

import {
  CiphertextCacheError,
  createCiphertextCache,
} from "./whisp-ciphertext-cache";

const photo = { messageId: "photo", fileUrl: "https://media.test/photo" };
function gate() {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, release: resolve };
}
function fixture() {
  const downloads: string[] = [];
  const removed: string[] = [];
  const cache = createCiphertextCache({
    download: async (url) => {
      downloads.push(url);
      return { uri: `file://${downloads.length}`, bytes: 10 };
    },
    remove: async (uri) => {
      removed.push(uri);
    },
  });
  return { cache, downloads, removed };
}

test("opening prefetched ciphertext reuses the download and releases it exactly once", async () => {
  const { cache, downloads, removed } = fixture();
  await cache.prefetch(photo, "alice");
  const file = await cache.acquire(photo, "alice");
  expect(downloads).toEqual([photo.fileUrl]);
  expect(removed).toEqual([]);
  await file.release();
  await file.release();
  expect(removed).toEqual([file.uri]);
});

test("opening an in-flight prefetch shares its transfer and removes the speculative size limit", async () => {
  const started = gate();
  const finish = gate();
  let downloads = 0;
  let limit: (() => number | null) | undefined;
  const cache = createCiphertextCache({
    download: async (_url, _signal, byteLimit) => {
      downloads++;
      limit = byteLimit;
      started.release();
      await finish.promise;
      return { uri: "file://shared", bytes: 64 * 1024 * 1024 };
    },
    remove: async () => {},
  });
  const prefetch = cache.prefetch(photo, "alice");
  await started.promise;
  expect(limit?.()).toBe(32 * 1024 * 1024);
  const opened = cache.acquire(photo, "alice");
  await Promise.resolve();
  expect(limit?.()).toBeNull();
  finish.release();
  const file = await opened;
  await prefetch;
  expect(downloads).toBe(1);
  await file.release();
});

test("an oversized speculative download does not prevent an explicit video open", async () => {
  let downloads = 0;
  const cache = createCiphertextCache({
    download: async (_url, _signal, limit) => {
      downloads++;
      if (limit() !== null)
        throw new CiphertextCacheError("limit", "Too large to prefetch");
      return { uri: "file://video", bytes: 64 * 1024 * 1024 };
    },
    remove: async () => {},
  });
  await expect(cache.prefetch(photo, "alice")).rejects.toMatchObject({
    reason: "limit",
  });
  const file = await cache.acquire(photo, "alice");
  expect(downloads).toBe(2);
  await file.release();
});

test("speculative cache evicts idle files after three entries", async () => {
  const { cache, removed } = fixture();
  for (let i = 0; i < 4; i++)
    await cache.prefetch(
      { messageId: `${i}`, fileUrl: `https://media.test/${i}` },
      "alice",
    );
  expect(removed).toEqual(["file://1"]);
  await cache.clear("alice");
  expect(removed).toHaveLength(4);
});

test("accounts and changed media URLs never reuse another download", async () => {
  const { cache, downloads, removed } = fixture();
  await cache.prefetch(photo, "alice");
  const bob = await cache.acquire(photo, "bob");
  expect(downloads).toHaveLength(2);
  await cache.clear("alice");
  expect(removed).toEqual(["file://1"]);
  const renewed = await cache.acquire(
    { ...photo, fileUrl: "https://media.test/replaced" },
    "bob",
  );
  expect(downloads).toHaveLength(3);
  await bob.release();
  await renewed.release();
});

test("account cleanup fences a ready file before its acquisition returns", async () => {
  const { cache, removed } = fixture();
  await cache.prefetch(photo, "alice");
  const pending = cache.acquire(photo, "alice");
  const clearing = Promise.resolve().then(() => cache.clear("alice"));
  await Promise.all([
    expect(pending).rejects.toMatchObject({ reason: "cancelled" }),
    clearing,
  ]);
  expect(removed).toEqual(["file://1"]);
});

test("withdrawing an inbox entry preserves an active reader until release", async () => {
  const { cache, removed } = fixture();
  const first = await cache.acquire(photo, "alice");
  const second = await cache.acquire(photo, "alice");
  await cache.retain("alice", []);
  expect(removed).toEqual([]);
  await first.release();
  expect(removed).toEqual([]);
  await second.release();
  expect(removed).toEqual([first.uri]);
});

test("account cleanup rejects a late transfer result and deletes its ciphertext", async () => {
  const started = gate();
  const finish = gate();
  const removed: string[] = [];
  const cache = createCiphertextCache({
    download: async () => {
      started.release();
      await finish.promise;
      return { uri: "file://late", bytes: 10 };
    },
    remove: async (uri) => {
      removed.push(uri);
    },
  });
  const pending = cache.prefetch(photo, "alice");
  const rejected = pending.catch((error: unknown) => error);
  await started.promise;
  await cache.clear("alice");
  finish.release();
  expect(await rejected).toMatchObject({ reason: "cancelled" });
  expect(removed).toEqual(["file://late"]);
});

test("a failed download is retried on demand instead of cached as success", async () => {
  let downloads = 0;
  const cache = createCiphertextCache({
    download: async () => {
      if (++downloads === 1) throw new TypeError("Network failed");
      return { uri: "file://retry", bytes: 10 };
    },
    remove: async () => {},
  });
  await expect(cache.prefetch(photo, "alice")).rejects.toThrow(
    "Network failed",
  );
  const file = await cache.acquire(photo, "alice");
  expect(downloads).toBe(2);
  await file.release();
});

test("concurrent speculative admission stays within three files", async () => {
  const { cache, downloads } = fixture();
  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      cache.prefetch(
        { messageId: `${i}`, fileUrl: `https://media.test/${i}` },
        "alice",
      ),
    ),
  );
  expect(downloads).toHaveLength(3);
  await cache.clear("alice");
});

test("an inbox update cannot cancel the whisp currently opening", async () => {
  const started = gate();
  const finish = gate();
  let aborted = false;
  const cache = createCiphertextCache({
    download: async (_url, signal) => {
      started.release();
      await finish.promise;
      aborted = signal.aborted;
      return { uri: "file://opening", bytes: 10 };
    },
    remove: async () => {},
  });
  const opening = cache.acquire(photo, "alice");
  await started.promise;
  await cache.retain("alice", []);
  finish.release();
  const file = await opening;
  expect(aborted).toBe(false);
  await file.release();
});

test("clearing an account fences acquisitions waiting for admission", async () => {
  const { cache, downloads } = fixture();
  const pending = cache
    .acquire(photo, "alice")
    .catch((error: unknown) => error);
  await cache.clear("alice");
  expect(await pending).toMatchObject({ reason: "cancelled" });
  expect(downloads).toEqual([]);
});

test("explicit opening cancels an unrelated speculative transfer", async () => {
  const started = gate();
  const cache = createCiphertextCache({
    download: async (url, signal) => {
      if (url === photo.fileUrl) {
        started.release();
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new CiphertextCacheError("cancelled", "Cancelled")),
            { once: true },
          ),
        );
      }
      return { uri: "file://priority", bytes: 10 };
    },
    remove: async () => {},
  });
  const prefetch = cache
    .prefetch(photo, "alice")
    .catch((error: unknown) => error);
  await started.promise;
  const file = await cache.acquire(
    { messageId: "wanted", fileUrl: "https://media.test/wanted" },
    "alice",
  );
  expect(await prefetch).toMatchObject({ reason: "cancelled" });
  await file.release();
});
