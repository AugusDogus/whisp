import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { and, eq } from "@acme/db";
import { ContentPolicyAcceptance, UserBlock, user } from "@acme/db/schema";
import { CONTENT_POLICY_VERSION, reportInput } from "@acme/validators";

import { AbuseReports } from "../services/abuse-reports";
import { Blocking } from "../services/blocking";
import { ContentAccess } from "../services/content-access";
import { ReportAlerts } from "../services/report-alerts";
import { protectedProcedure } from "../trpc";

const userInput = z.object({ userId: z.string().min(1).max(128) });

export const safetyRouter = {
  status: protectedProcedure.query(({ ctx }) =>
    ContentAccess.status(ctx.db, ctx.session.user.id),
  ),

  acceptPolicy: protectedProcedure
    .input(z.object({ version: z.literal(CONTENT_POLICY_VERSION) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(ContentPolicyAcceptance)
        .values({ userId: ctx.session.user.id, version: input.version })
        .onConflictDoUpdate({
          target: ContentPolicyAcceptance.userId,
          set: { version: input.version, acceptedAt: new Date() },
        });
      return { ok: true };
    }),

  blockedUsers: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select({ id: user.id, name: user.name, image: user.image })
      .from(UserBlock)
      .innerJoin(user, eq(user.id, UserBlock.blockedId))
      .where(eq(UserBlock.blockerId, ctx.session.user.id)),
  ),

  block: protectedProcedure
    .input(userInput)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.transaction((tx) =>
        Blocking.block(tx, ctx.session.user.id, input.userId),
      );
      if (result.status !== "blocked")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This account cannot be blocked. Refresh and try again.",
        });
      return { ok: true };
    }),

  unblock: protectedProcedure
    .input(userInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(UserBlock)
        .where(
          and(
            eq(UserBlock.blockerId, ctx.session.user.id),
            eq(UserBlock.blockedId, input.userId),
          ),
        );
      return { ok: true };
    }),

  report: protectedProcedure
    .input(reportInput)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.transaction((tx) =>
        AbuseReports.submit(tx, ctx.session.user.id, input),
      );
      if (result.status === "rate_limited")
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message:
            "You have reached the daily report limit. Try again tomorrow or contact augie@luebbers.email for urgent help.",
        });
      if (result.status === "duplicate") return { ok: true };
      if (result.status !== "submitted")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This report could not be submitted. Refresh the account and try again.",
        });
      // The report is already saved; a missed alert must not fail the request.
      const alert = await ReportAlerts.notify(
        process.env.DISCORD_REPORTS_WEBHOOK_URL,
        { id: result.reportId, reason: input.reason },
      );
      if (alert.status === "failed" || alert.status === "misconfigured")
        console.error(
          `Report ${result.reportId} was saved, but its Discord alert was not sent (${alert.status === "failed" ? alert.reason : "DISCORD_REPORTS_WEBHOOK_URL is not a Discord webhook URL"}). Check the variable in Vercel; pending reports are listed by the moderation CLI's list command.`,
        );
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
