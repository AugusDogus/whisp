import { and, eq, sql } from "@acme/db";
import type { db } from "@acme/db/client";
import { AbuseReport, user } from "@acme/db/schema";
import { reportInput } from "@acme/validators";

export const AbuseReports = {
  async submit(
    database: Pick<typeof db, "select" | "insert">,
    reporterId: string,
    input: unknown,
  ) {
    const parsed = reportInput.safeParse(input);
    if (!parsed.success) return { status: "invalid" } as const;
    const report = parsed.data;
    if (report.userId === reporterId) return { status: "self" } as const;
    const [target] = await database
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, report.userId));
    if (!target) return { status: "missing" } as const;
    const [duplicate] = await database
      .select({ id: AbuseReport.id })
      .from(AbuseReport)
      .where(
        and(
          eq(AbuseReport.reporterId, reporterId),
          eq(AbuseReport.reportedUserId, report.userId),
          eq(AbuseReport.status, "pending"),
          eq(AbuseReport.reason, report.reason),
          eq(AbuseReport.details, report.details),
        ),
      );
    if (duplicate) return { status: "duplicate" } as const;
    const [count] = await database
      .select({ value: sql<number>`count(*)` })
      .from(AbuseReport)
      .where(
        and(
          eq(AbuseReport.reporterId, reporterId),
          sql`${AbuseReport.createdAt} >= ${Math.floor(Date.now() / 1000) - 86400}`,
        ),
      );
    if ((count?.value ?? 0) >= 10) return { status: "rate_limited" } as const;
    const [created] = await database
      .insert(AbuseReport)
      .values({
        reporterId,
        reportedUserId: report.userId,
        reason: report.reason,
        details: report.details,
      })
      .returning({ id: AbuseReport.id });
    // The transaction rolls back, so the reporter sees a failure and can retry.
    if (!created)
      throw new Error(
        `AbuseReports.submit: inserting a report from ${reporterId} returned no row; nothing was saved.`,
      );
    return { status: "submitted", reportId: created.id } as const;
  },
};
