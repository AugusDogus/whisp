import type { TRPCRouterRecord } from "@trpc/server";

import { REST } from "@discordjs/rest";
import { TRPCError } from "@trpc/server";
import { Routes } from "discord-api-types/v10";
import { z } from "zod/v4";

import { authEnv } from "@acme/auth/env";

import { AccountDeletion } from "../services/account-deletion";
import { DiscordProfile } from "../services/discord-profile";
import { protectedProcedure, publicProcedure } from "../trpc";
import { PreviewScope } from "../uploadthing/preview-scope";

const env = authEnv();
const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);
const fetchDiscordUser = (discordId: string) =>
  rest.get(Routes.user(discordId));

export const authRouter = {
  discordProfile: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const result = await DiscordProfile.read(
        ctx.db,
        ctx.session.user.id,
        input.userId,
      );
      if (!result.success) {
        throw new TRPCError({ code: result.code, message: result.error });
      }
      return { profile: result.profile, needsRefresh: result.needsRefresh };
    }),
  getSession: publicProcedure.query(({ ctx }) => {
    return ctx.session;
  }),
  getSecretMessage: protectedProcedure.query(() => {
    return "you can see this secret message!";
  }),
  deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
    return AccountDeletion.remove(
      ctx.db,
      ctx.session.user.id,
      PreviewScope.fromEnvironment(process.env),
    );
  }),

  refreshAvatar: protectedProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        mode: z.enum(["force", "if-stale"]).default("force"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await DiscordProfile.refresh(
        ctx.db,
        ctx.session.user.id,
        input.userId,
        fetchDiscordUser,
        input.mode,
      );
      if (!result.success) return result;
      return { ...result, image: result.profile.avatarUrl };
    }),
} satisfies TRPCRouterRecord;
