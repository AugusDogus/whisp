import { PreviewScope } from "./preview-scope";

type PreviewFile = {
  key: string;
  customId: string | null;
  status: "Uploaded" | "Uploading" | "Deletion Pending" | "Failed";
};

export interface PreviewFileStore {
  listFiles(options: { limit: number; offset: number }): Promise<{
    files: readonly PreviewFile[];
    hasMore: boolean;
  }>;
  deleteFiles(
    keys: string[],
  ): Promise<{ success: boolean; deletedCount: number }>;
}

// Collect before deleting: deleting a page while advancing an offset skips files.
async function listFiles(store: PreviewFileStore) {
  const files: PreviewFile[] = [];
  for (let offset = 0; ; ) {
    const page = await store.listFiles({ limit: 500, offset });
    files.push(...page.files);
    if (!page.hasMore) return files;
    if (page.files.length === 0) {
      throw new Error(
        "UploadThing returned an empty page with hasMore=true. No files were deleted; rerun cleanup.",
      );
    }
    offset += page.files.length;
  }
}

export const PreviewCleanup = {
  async discover(store: PreviewFileStore): Promise<string[]> {
    const files = await listFiles(store);
    return [
      ...new Set(
        files.flatMap((file) => {
          const scope = PreviewScope.fromCustomId(file.customId);
          return scope ? [scope.prNumber] : [];
        }),
      ),
    ];
  },
  async deleteFiles(store: PreviewFileStore, scope: PreviewScope) {
    const files = (await listFiles(store)).filter((file) =>
      PreviewScope.owns(scope, file.customId),
    );
    const keys = files
      .filter((file) => file.status === "Uploaded" || file.status === "Failed")
      .map((file) => file.key);
    for (let offset = 0; offset < keys.length; offset += 100) {
      const result = await store.deleteFiles(keys.slice(offset, offset + 100));
      if (!result.success) {
        throw new Error(
          `UploadThing deletion failed for PR ${scope.prNumber}. The preview database is preserved; rerun cleanup.`,
        );
      }
    }
    // A partial response must not silently orphan files. Concurrent normal
    // message cleanup can legitimately make deletedCount smaller than the batch.
    if (keys.length > 0) {
      const remaining = (await listFiles(store)).filter(
        (file) =>
          PreviewScope.owns(scope, file.customId) &&
          (file.status === "Uploaded" || file.status === "Failed"),
      );
      if (remaining.length > 0) {
        throw new Error(
          `UploadThing still lists completed files for PR ${scope.prNumber}. Rerun cleanup; no database was deleted.`,
        );
      }
    }
    return {
      requested: keys.length,
      uploading: files.filter((file) => file.status === "Uploading").length,
    };
  },
} as const;
