import type { TRPCRouterRecord } from "@trpc/server";
import { eq } from "drizzle-orm";

import { user } from "@acme/db/schema";

import { protectedProcedure, publicProcedure } from "../trpc";

export const authRouter = {
  getSession: publicProcedure.query(({ ctx }) => {
    return ctx.session;
  }),
  getSecretMessage: protectedProcedure.query(() => {
    return "you can see this secret message!";
  }),
  deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Delete the user (cascade will handle sessions, accounts, etc.)
    await ctx.db.delete(user).where(eq(user.id, userId));

    // Sign out the user
    await ctx.authApi.signOut({
      headers: new Headers(),
    });

    return { success: true };
  }),
} satisfies TRPCRouterRecord;
