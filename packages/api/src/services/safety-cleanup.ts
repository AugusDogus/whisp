import type { PreviewScope } from "../uploadthing/preview-scope";

import { lte } from "drizzle-orm";

import { or, sql } from "@acme/db";
import type { db } from "@acme/db/client";
import {
  AbuseEnforcement,
  AbuseReport,
  AccountSuspension,
} from "@acme/db/schema";

import { FileDeletions } from "./file-deletions";
import { MessageRetention } from "./message-retention";

export const SafetyCleanup = {
  async run(
    database: typeof db,
    scope: PreviewScope | undefined,
    deleteFile: (key: string) => Promise<{ success: boolean }>,
    now = new Date(),
  ) {
    const messages = await database.transaction(async (tx) => {
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
      return MessageRetention.purge(tx, now);
    });
    const files = await FileDeletions.run(database, scope, deleteFile, now);
    return { ...files, messages };
  },
} as const;
