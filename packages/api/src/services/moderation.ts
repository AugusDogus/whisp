import { z } from "zod/v4";

import { and, eq, or, sql } from "@acme/db";
import type { db } from "@acme/db/client";
import { Enforcement } from "@acme/db/enforcement";
import type { EnforcementConfig } from "@acme/db/enforcement";
import {
  AbuseEnforcement,
  AbuseReport,
  AccountSuspension,
  account,
} from "@acme/db/schema";

const futureDate = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .refine(
    (value) => value.getTime() > Date.now(),
    "Expiry must be in the future",
  );
export const ModerationDecision = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("suspend"), expiresAt: futureDate }),
  z.object({
    action: z.literal("enforce"),
    expiresAt: futureDate,
    reason: z.enum([
      "child_safety",
      "credible_threat",
      "nonconsensual_intimate_content",
      "repeated_severe_harassment",
    ]),
    confirmedSeriousAbuse: z.literal(true),
    necessaryDespiteDeletion: z.literal(true),
    shorterPeriodInsufficient: z.literal(true),
    rightsAndAgeConsidered: z.literal(true),
  }),
]);

export const Moderation = {
  async resolve(
    database: typeof db,
    reportId: string,
    input: unknown,
    config: EnforcementConfig = { key: undefined, policyVersion: undefined },
  ) {
    const parsed = ModerationDecision.safeParse(input);
    if (!parsed.success) return { status: "invalid_decision" } as const;
    const decision = parsed.data;
    return database.transaction(async (tx) => {
      const [report] = await tx
        .select()
        .from(AbuseReport)
        .where(eq(AbuseReport.id, reportId));
      if (!report) return { status: "missing" } as const;
      if (report.status !== "pending")
        return { status: "already_reviewed" } as const;
      let enforcementId: string | undefined;
      if (decision.action !== "dismiss") {
        if (!report.reportedUserId)
          return { status: "account_deleted" } as const;
        // Never silently overwrite or extend an existing decision.
        const [existing] = await tx
          .select()
          .from(AccountSuspension)
          .where(
            and(
              eq(AccountSuspension.userId, report.reportedUserId),
              or(
                sql`${AccountSuspension.expiresAt} is null`,
                sql`${AccountSuspension.expiresAt} > unixepoch()`,
              ),
            ),
          );
        if (existing) return { status: "already_suspended" } as const;
        if (decision.action === "enforce") {
          if (!config.policyVersion)
            return { status: "retention_not_configured" } as const;
          const [linked] = await tx
            .select({ discordId: account.accountId })
            .from(account)
            .where(
              and(
                eq(account.userId, report.reportedUserId),
                eq(account.providerId, "discord"),
              ),
            );
          if (!linked) return { status: "missing_identity" } as const;
          const identity = await Enforcement.identity(
            tx,
            config,
            linked.discordId,
          );
          if (identity.status !== "ready") return identity;
          const [prior] = await tx
            .select()
            .from(AbuseEnforcement)
            .where(eq(AbuseEnforcement.fingerprint, identity.fingerprint));
          if (prior && prior.expiresAt > new Date())
            return { status: "already_suspended" } as const;
          if (prior)
            await tx
              .delete(AbuseEnforcement)
              .where(eq(AbuseEnforcement.id, prior.id));
          enforcementId = crypto.randomUUID();
          await tx.insert(AbuseEnforcement).values({
            id: enforcementId,
            fingerprint: identity.fingerprint,
            keyTag: identity.keyTag,
            reason: decision.reason,
            policyVersion: config.policyVersion,
            necessity: "likely_serious_abuse_on_return",
            decidedAt: new Date(),
            expiresAt: decision.expiresAt,
          });
        }
        await tx
          .insert(AccountSuspension)
          .values({
            userId: report.reportedUserId,
            enforcementId,
            expiresAt: decision.expiresAt,
          })
          .onConflictDoUpdate({
            target: AccountSuspension.userId,
            set: {
              enforcementId: enforcementId ?? null,
              expiresAt: decision.expiresAt,
            },
          });
      }
      // Do not keep free-text allegations as an indefinite evidence archive.
      await tx
        .update(AbuseReport)
        .set({
          status: decision.action === "dismiss" ? "dismissed" : "actioned",
          details: "",
          reviewedAt: new Date(),
        })
        .where(eq(AbuseReport.id, reportId));
      return {
        status: "resolved",
        ...(enforcementId ? { enforcementId } : {}),
      } as const;
    });
  },
  async restore(database: typeof db, userId: string) {
    await database.transaction(async (tx) => {
      const [suspension] = await tx
        .select()
        .from(AccountSuspension)
        .where(eq(AccountSuspension.userId, userId));
      if (suspension?.enforcementId)
        await tx
          .delete(AbuseEnforcement)
          .where(eq(AbuseEnforcement.id, suspension.enforcementId));
      await tx
        .delete(AccountSuspension)
        .where(eq(AccountSuspension.userId, userId));
    });
  },
};
