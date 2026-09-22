import type { PreviewScope } from "../uploadthing/preview-scope";

import { asc } from "drizzle-orm";

import { eq, sql } from "@acme/db";
import type { db } from "@acme/db/client";
import { FileDeletion, PreviewUpload } from "@acme/db/schema";

import { PreviewUploads } from "../uploadthing/preview-uploads";

type DeleteFile = (key: string) => Promise<{ success: boolean }>;

export const FileDeletions = {
  async process(
    database: typeof db,
    scope: PreviewScope | undefined,
    fileKey: string,
    deleteFile: DeleteFile,
    now = new Date(),
  ) {
    // Stamp before calling storage so even a terminated worker yields to other jobs.
    const attempt = await database
      .update(FileDeletion)
      .set({ lastAttemptAt: now })
      .where(eq(FileDeletion.fileKey, fileKey));
    if (attempt.rowsAffected === 0) return { status: "skipped" } as const;
    if (!(await PreviewUploads.canDelete(database, scope, fileKey))) {
      await database
        .delete(FileDeletion)
        .where(eq(FileDeletion.fileKey, fileKey));
      return { status: "skipped" } as const;
    }
    try {
      const result = await deleteFile(fileKey);
      if (!result.success) return { status: "failed" } as const;
    } catch {
      // The durable job remains pending, with its original creation date intact.
      return { status: "failed" } as const;
    }
    await database.transaction(async (tx) => {
      await tx.delete(PreviewUpload).where(eq(PreviewUpload.fileKey, fileKey));
      await tx.delete(FileDeletion).where(eq(FileDeletion.fileKey, fileKey));
    });
    return { status: "deleted" } as const;
  },

  async run(
    database: typeof db,
    scope: PreviewScope | undefined,
    deleteFile: DeleteFile,
    now = new Date(),
  ) {
    const pending = await database
      .select({ fileKey: FileDeletion.fileKey })
      .from(FileDeletion)
      .orderBy(
        asc(
          sql`coalesce(${FileDeletion.lastAttemptAt}, ${FileDeletion.createdAt})`,
        ),
        asc(FileDeletion.createdAt),
        asc(FileDeletion.fileKey),
      )
      .limit(100);
    let failed = 0;
    let deleted = 0;
    for (const file of pending) {
      const result = await FileDeletions.process(
        database,
        scope,
        file.fileKey,
        deleteFile,
        now,
      );
      if (result.status === "failed") failed++;
      if (result.status === "deleted") deleted++;
    }
    return { deleted, failed };
  },
} as const;
