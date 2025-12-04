import type { TRPCRouterRecord } from "@trpc/server";
import type { APIUser } from "discord-api-types/v10";
import { calculateUserDefaultAvatarIndex, CDN, REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";

import { account, user } from "@acme/db/schema";

import { protectedProcedure, publicProcedure } from "../trpc";

const cdn = new CDN();

async function fetchDiscordAvatar(
  discordUserId: string,
): Promise<string | null> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return null;

  try {
    const rest = new REST({ version: "10" }).setToken(botToken);
    const discordUser = (await rest.get(Routes.user(discordUserId))) as APIUser;

    if (!discordUser.avatar) {
      return cdn.defaultAvatar(calculateUserDefaultAvatarIndex(discordUserId));
    }

    return cdn.avatar(discordUserId, discordUser.avatar, { size: 256 });
  } catch {
    return null;
  }
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
