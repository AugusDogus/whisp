import type { TRPCRouterRecord } from "@trpc/server";

import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, eq, ne } from "@acme/db";
import { PushToken, user } from "@acme/db/schema";

import { protectedProcedure } from "../trpc";

export const notificationsRouter = {
  // Register or update a push token for the current device
  registerPushToken: protectedProcedure
    .input(
      z.object({
        token: z.string(),
        platform: z.enum(["ios", "android", "web"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const sessionId = ctx.session.session.id;

      // Replace the session's old address and transfer token ownership atomically.
      // The session foreign key prevents revoked sessions from registering again.
      const [, [registered]] = await ctx.db.batch([
        ctx.db
          .delete(PushToken)
          .where(
            and(
              eq(PushToken.sessionId, sessionId),
              ne(PushToken.token, input.token),
            ),
          ),
        ctx.db
          .insert(PushToken)
          .values({
            userId,
            sessionId,
            token: input.token,
            platform: input.platform,
          })
          .onConflictDoUpdate({
            target: PushToken.token,
            set: {
              userId,
              sessionId,
              platform: input.platform,
              updatedAt: new Date(),
            },
          })
          .returning(),
      ]);

      if (!registered) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Could not register this device for notifications. Please try again.",
        });
      }
      return { success: true, tokenId: registered.id };
    }),

  // Remove a push token (when user logs out or disables notifications)
  removePushToken: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(PushToken)
        .where(
          and(
            eq(PushToken.token, input.token),
            eq(PushToken.userId, ctx.session.user.id),
            eq(PushToken.sessionId, ctx.session.session.id),
          ),
        );

      return { success: true };
    }),

  // Get notification preferences
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const userData = await ctx.db.query.user.findFirst({
      where: (users, { eq: colEq }) => colEq(users.id, ctx.session.user.id),
      columns: {
        notifyOnMessages: true,
        notifyOnFriendActivity: true,
      },
    });

    return {
      notifyOnMessages: userData?.notifyOnMessages ?? true,
      notifyOnFriendActivity: userData?.notifyOnFriendActivity ?? true,
    };
  }),

  // Update notification preferences
  updatePreferences: protectedProcedure
    .input(
      z.object({
        notifyOnMessages: z.boolean().optional(),
        notifyOnFriendActivity: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, boolean> = {};

      if (input.notifyOnMessages !== undefined) {
        updates.notifyOnMessages = input.notifyOnMessages;
      }
      if (input.notifyOnFriendActivity !== undefined) {
        updates.notifyOnFriendActivity = input.notifyOnFriendActivity;
      }

      await ctx.db
        .update(user)
        .set(updates)
        .where(eq(user.id, ctx.session.user.id));

      return { success: true };
    }),
} satisfies TRPCRouterRecord;
