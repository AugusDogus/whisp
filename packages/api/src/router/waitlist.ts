import type { TRPCRouterRecord } from "@trpc/server";
import { count, eq } from "drizzle-orm";

import { user, Waitlist } from "@acme/db/schema";

import { protectedProcedure, publicProcedure } from "../trpc";

export const waitlistRouter = {
  join: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Check if user is already on waitlist
    const existing = await ctx.db.query.Waitlist.findFirst({
      where: eq(Waitlist.userId, userId),
    });

    if (existing) {
      return { success: true, alreadyJoined: true };
    }

    // Add user to waitlist
    await ctx.db.insert(Waitlist).values({
      userId,
    });

    return { success: true, alreadyJoined: false };
  }),

  getCount: publicProcedure.query(async ({ ctx }) => {
    // Count all unique users (pre-alpha testers + waitlist, no double counting)
    // Since waitlist.userId references user.id, all waitlist entries are already users
    // So we just need to count total users
    const [userCount] = await ctx.db.select({ count: count() }).from(user);

    return { count: userCount?.count ?? 0 };
  }),

  isUserOnWaitlist: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const existing = await ctx.db.query.Waitlist.findFirst({
      where: eq(Waitlist.userId, userId),
    });

    return { onWaitlist: !!existing };
  }),
} satisfies TRPCRouterRecord;
