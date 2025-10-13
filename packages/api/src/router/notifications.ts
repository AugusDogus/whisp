import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { eq } from "@acme/db";
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

      // Check if this token already exists for this user
      const existing = await ctx.db.query.PushToken.findFirst({
        where: (tokens, { and, eq }) =>
          and(eq(tokens.userId, userId), eq(tokens.token, input.token)),
      });

      if (existing) {
        // Update the existing token
        await ctx.db
          .update(PushToken)
          .set({
            platform: input.platform,
            updatedAt: new Date(),
          })
          .where(eq(PushToken.id, existing.id));

        return { success: true, tokenId: existing.id };
      }

      // Create a new token
      const [newToken] = await ctx.db
        .insert(PushToken)
        .values({
          userId,
          token: input.token,
          platform: input.platform,
        })
        .returning();

      if (!newToken) {
        throw new Error("Failed to create push token");
      }

      return { success: true, tokenId: newToken.id };
    }),

  // Remove a push token (when user logs out or disables notifications)
  removePushToken: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(PushToken).where(eq(PushToken.token, input.token));

      return { success: true };
    }),

  // Get notification preferences
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const userData = await ctx.db.query.user.findFirst({
      where: (users, { eq }) => eq(users.id, ctx.session.user.id),
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
