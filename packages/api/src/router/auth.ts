import type { TRPCRouterRecord } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";

import { account, user } from "@acme/db/schema";

import { protectedProcedure, publicProcedure } from "../trpc";

async function fetchDiscordAvatar(
  discordUserId: string,
): Promise<string | null> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return null;

  const response = await fetch(
    `https://discord.com/api/v10/users/${discordUserId}`,
    { headers: { Authorization: `Bot ${botToken}` } },
  );

  if (!response.ok) return null;

  const data = (await response.json()) as { id: string; avatar: string | null };

  if (!data.avatar) {
    const index = Number((BigInt(discordUserId) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }

  const format = data.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${data.avatar}.${format}?size=256`;
}

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

  refreshAvatar: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [discordAccount] = await ctx.db
        .select()
        .from(account)
        .where(eq(account.userId, input.userId))
        .limit(1);

      if (!discordAccount) {
        return { success: false, error: "No Discord account linked" };
      }

      const avatarUrl = await fetchDiscordAvatar(discordAccount.accountId);

      if (!avatarUrl) {
        return { success: false, error: "Failed to fetch avatar from Discord" };
      }

      await ctx.db
        .update(user)
        .set({ image: avatarUrl })
        .where(eq(user.id, input.userId));

      return { success: true, image: avatarUrl };
    }),
} satisfies TRPCRouterRecord;
