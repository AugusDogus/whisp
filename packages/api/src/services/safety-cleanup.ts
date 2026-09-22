import type { PreviewScope } from "../uploadthing/preview-scope";

import { asc, lte } from "drizzle-orm";

import { eq, or, sql } from "@acme/db";
import type { db } from "@acme/db/client";
import {
  AbuseEnforcement,
  AbuseReport,
  AccountSuspension,
  FileDeletion,
  PreviewUpload,
} from "@acme/db/schema";

import { PreviewUploads } from "../uploadthing/preview-uploads";

export const SafetyCleanup = {
  async run(
    database: typeof db,
    scope: PreviewScope | undefined,
    deleteFile: (key: string) => Promise<{ success: boolean }>,
    now = new Date(),
  ) {
    await database.transaction(async (tx) => {
      await tx
        .delete(AccountSuspension)
        .where(lte(AccountSuspension.expiresAt, now));
      await tx
        .delete(AbuseEnforcement)
        .where(lte(AbuseEnforcement.expiresAt, now));
      await tx
        .delete(AbuseReport)
        .where(
          or(
            lte(
              AbuseReport.createdAt,
              new Date(now.getTime() - 30 * 86400_000),
            ),
            sql`${AbuseReport.reporterId} is null or ${AbuseReport.reportedUserId} is null`,
          ),
        );
    });
    const pending = await database
      .select()
      .from(FileDeletion)
      .orderBy(asc(FileDeletion.createdAt))
      .limit(100);
    let failed = 0;
    let deleted = 0;
    for (const file of pending) {
      // A preview DB can inherit a production deletion queue. Never touch those files.
      if (!(await PreviewUploads.canDelete(database, scope, file.fileKey))) {
        await database
          .delete(FileDeletion)
          .where(eq(FileDeletion.fileKey, file.fileKey));
        continue;
      }
      try {
        const result = await deleteFile(file.fileKey);
        if (!result.success) {
          failed++;
          continue;
        }
      } catch {
        failed++;
        continue; // Keep the durable job for the next run. Report failure below.
      }
      await database.transaction(async (tx) => {
        await tx
          .delete(PreviewUpload)
          .where(eq(PreviewUpload.fileKey, file.fileKey));
        await tx
          .delete(FileDeletion)
          .where(eq(FileDeletion.fileKey, file.fileKey));
      });
      deleted++;
    }
    return { deleted, failed };
  },
} as const;
