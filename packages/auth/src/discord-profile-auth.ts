import type { BetterAuthOptions } from "better-auth";

import { defineRequestState } from "@better-auth/core/context";
import { APIError } from "better-auth/api";

import { DiscordProfile } from "./discord-profile";

// Better Auth 1.6 excludes input:false fields even from provider mappings.
// Carry validated server data in request state and merge it only at the DB boundary.
const profileState = defineRequestState<DiscordProfile | null>(() => null);

async function mapProfileToUser(input: unknown) {
  const parsed = DiscordProfile.parse(input);
  if (!parsed.success) {
    throw new APIError("BAD_GATEWAY", {
      message:
        "Discord returned unexpected profile data. Your saved profile is unchanged. Please try signing in again later.",
    });
  }
  await profileState.set(parsed.data);
  return { image: parsed.data.avatarUrl };
}

async function userFields() {
  const profile = await profileState.get();
  return profile ? DiscordProfile.toUserFields(profile) : {};
}

const databaseHooks: NonNullable<BetterAuthOptions["databaseHooks"]> = {
  user: {
    create: {
      before: async (user) => ({ data: { ...user, ...(await userFields()) } }),
    },
    update: {
      before: async (user) => ({ data: { ...user, ...(await userFields()) } }),
    },
  },
  session: {
    create: {
      before: async (session, context) => {
        if (context?.path !== "/oauth-proxy-callback") return;
        // The proxy forwards only standard identity fields. Fetch the full profile
        // with its verified Discord token in the destination database's request.
        const accounts = await context.context.internalAdapter.findAccounts(
          session.userId,
        );
        const account = accounts.find(
          (candidate) => candidate.providerId === "discord",
        );
        if (!account?.accessToken) {
          throw new APIError("BAD_GATEWAY", {
            message:
              "Discord profile sync could not find the sign-in token. Please sign in again.",
          });
        }
        let input: unknown;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
          const response = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${account.accessToken}` },
            signal: controller.signal,
          });
          if (!response.ok)
            throw new Error(`Discord returned HTTP ${response.status}`);
          input = await response.json();
        } catch {
          throw new APIError("BAD_GATEWAY", {
            message:
              "Discord profile sync failed during preview sign-in. Please try signing in again.",
          });
        } finally {
          clearTimeout(timeout);
        }
        const parsed = DiscordProfile.parse(input);
        if (!parsed.success || parsed.data.id !== account.accountId) {
          throw new APIError("BAD_GATEWAY", {
            message:
              "Discord returned unexpected profile data during preview sign-in. Please try signing in again.",
          });
        }
        await context.context.internalAdapter.updateUser(
          session.userId,
          DiscordProfile.toUserFields(parsed.data),
        );
      },
    },
  },
};

export const DiscordProfileAuth = { mapProfileToUser, databaseHooks } as const;
