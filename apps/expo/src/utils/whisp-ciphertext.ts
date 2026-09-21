import {
  CiphertextCacheError,
  createCiphertextCache,
} from "./whisp-ciphertext-cache";

let initialization: Promise<string> | undefined;
function directory() {
  initialization ??= (async () => {
    const FS = await import("expo-file-system/legacy");
    if (!FS.cacheDirectory)
      throw new Error(
        "Private file storage is unavailable. Restart Whisp and retry.",
      );
    const root = `${FS.cacheDirectory}whisp-ciphertext/`;
    // No persisted index or keys: discard orphaned ciphertext after a restart.
    await FS.deleteAsync(root, { idempotent: true });
    await FS.makeDirectoryAsync(root, { intermediates: true });
    return root;
  })().catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}

const cache = createCiphertextCache({
  remove: async (uri) => {
    const FS = await import("expo-file-system/legacy");
    await FS.deleteAsync(uri, { idempotent: true });
  },
  download: async (url, signal, byteLimit) => {
    const FS = await import("expo-file-system/legacy");
    const { newId } = await import("react-native-whisp-mls");
    const root = await directory();
    if (signal.aborted)
      throw new CiphertextCacheError(
        "cancelled",
        "The encrypted download was cancelled.",
      );
    const uri = `${root}${newId()}.age`;
    let limitExceeded = false;
    let cancellation: Promise<void> | undefined;
    const cancellationState: { failure: { error: unknown } | null } = {
      failure: null,
    };
    const cancel = () => {
      cancellation ??= task.cancelAsync().catch((error) => {
        cancellationState.failure = { error };
      });
    };
    const task = FS.createDownloadResumable(url, uri, {}, (progress) => {
      const limit = byteLimit();
      if (
        limit !== null &&
        Math.max(
          progress.totalBytesWritten,
          progress.totalBytesExpectedToWrite,
        ) > limit
      ) {
        limitExceeded = true;
        cancel();
      }
    });
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const response = await (async () => {
        try {
          return await task.downloadAsync();
        } finally {
          // Expo legacy downloads keep their progress subscription until cancel,
          // including after success. Cancellation is a no-op for a finished task.
          cancel();
          if (cancellation) await cancellation;
        }
      })();
      if (cancellationState.failure) throw cancellationState.failure.error;
      if (limitExceeded)
        throw new CiphertextCacheError(
          "limit",
          "This encrypted file will download when opened.",
        );
      if (signal.aborted)
        throw new CiphertextCacheError(
          "cancelled",
          "The encrypted download was cancelled.",
        );
      if (response?.status !== 200)
        throw new Error(
          "The encrypted media could not be downloaded. Retry this whisp.",
        );
      const info = await FS.getInfoAsync(uri);
      if (!info.exists)
        throw new Error(
          "The encrypted download is unavailable. Retry this whisp.",
        );
      const limit = byteLimit();
      if (limit !== null && info.size > limit)
        throw new CiphertextCacheError(
          "limit",
          "This encrypted file will download when opened.",
        );
      return { uri, bytes: info.size };
    } catch (error) {
      if (cancellation) await cancellation;
      await FS.deleteAsync(uri, { idempotent: true });
      if (limitExceeded)
        throw new CiphertextCacheError(
          "limit",
          "This encrypted file will download when opened.",
        );
      throw error;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  },
});

export const acquireWhispCiphertext = cache.acquire;
export const prefetchWhispCiphertext = cache.prefetch;
export const retainWhispCiphertexts = cache.retain;
export const clearWhispCiphertexts = cache.clear;
