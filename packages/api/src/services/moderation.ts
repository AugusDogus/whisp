import { eq } from "@acme/db";
import type { db } from "@acme/db/client";
import { AbuseReport, AccountSuspension } from "@acme/db/schema";

export const Moderation = {
  async resolve(
    database: typeof db,
    reportId: string,
    action: "dismiss" | "suspend",
  ) {
    return database.transaction(async (tx) => {
      const [report] = await tx
        .select()
        .from(AbuseReport)
        .where(eq(AbuseReport.id, reportId));
      if (!report) return { status: "missing" } as const;
      if (report.status !== "pending")
        return { status: "already_reviewed" } as const;
      if (action === "suspend") {
        if (!report.reportedUserId)
          return { status: "account_deleted" } as const;
        await tx
          .insert(AccountSuspension)
          .values({ userId: report.reportedUserId })
          .onConflictDoNothing();
      }
      await tx
        .update(AbuseReport)
        .set({
          status: action === "suspend" ? "actioned" : "dismissed",
          reviewedAt: new Date(),
        })
        .where(eq(AbuseReport.id, reportId));
      return { status: "resolved" } as const;
    });
  },
};
