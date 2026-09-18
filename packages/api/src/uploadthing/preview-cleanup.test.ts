import type { PreviewFileStore } from "./preview-cleanup";

import { expect, test } from "bun:test";

import { PreviewCleanup } from "./preview-cleanup";
import { PreviewScope } from "./preview-scope";

const scope = PreviewScope.parse("17");
const id = (pr: string) =>
  `whisp-pr-${pr}:00000000-0000-4000-8000-000000000001`;

test("cleanup paginates before deletion and excludes production, other PRs, and in-flight files", async () => {
  const events: string[] = [];
  let deleted = false;
  const store: PreviewFileStore = {
    async listFiles({ offset }) {
      events.push(`list:${offset}`);
      if (deleted) return { files: [], hasMore: false };
      return offset === 0
        ? {
            files: [
              { key: "production", customId: null, status: "Uploaded" },
              { key: "own1", customId: id("17"), status: "Uploaded" },
            ],
            hasMore: true,
          }
        : {
            files: [
              { key: "other", customId: id("18"), status: "Uploaded" },
              { key: "own2", customId: id("17"), status: "Uploaded" },
              { key: "in-flight", customId: id("17"), status: "Uploading" },
              {
                key: "lookalike",
                customId: "whisp-pr-17:not-a-uuid",
                status: "Uploaded",
              },
            ],
            hasMore: false,
          };
    },
    async deleteFiles(keys) {
      events.push(`delete:${keys.join(",")}`);
      deleted = true;
      return { success: true, deletedCount: keys.length };
    },
  };
  expect(await PreviewCleanup.deleteFiles(store, scope)).toEqual({
    requested: 2,
    uploading: 1,
  });
  expect(events).toEqual(["list:0", "list:2", "delete:own1,own2", "list:0"]);
});

test("a sweep can discover a late upload even without its database callback", async () => {
  const store: PreviewFileStore = {
    async listFiles() {
      return {
        files: [{ key: "late", customId: id("17"), status: "Uploaded" }],
        hasMore: false,
      };
    },
    async deleteFiles() {
      throw new Error("Discovery must not delete files");
    },
  };
  expect(await PreviewCleanup.discover(store)).toEqual(["17"]);
});

test.each([false, true])(
  "failed or partial deletion fails cleanup (success=%s)",
  async (success) => {
    const store: PreviewFileStore = {
      async listFiles() {
        return {
          files: [{ key: "own", customId: id("17"), status: "Uploaded" }],
          hasMore: false,
        };
      },
      async deleteFiles() {
        return { success, deletedCount: 0 };
      },
    };
    await expect(PreviewCleanup.deleteFiles(store, scope)).rejects.toThrow();
  },
);

test("list failures never trigger deletion", async () => {
  let deleted = false;
  const store: PreviewFileStore = {
    async listFiles() {
      throw new Error("rate limited");
    },
    async deleteFiles() {
      deleted = true;
      return { success: true, deletedCount: 0 };
    },
  };
  await expect(PreviewCleanup.deleteFiles(store, scope)).rejects.toThrow(
    "rate limited",
  );
  expect(deleted).toBe(false);
});
