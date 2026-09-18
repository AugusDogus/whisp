import type { BetterAuthOptions } from "better-auth";

import { betterAuth } from "better-auth";
import { oAuthProxy } from "better-auth/plugins";

import { DiscordProfileAuth } from "./discord-profile-auth";
import { expoWithOAuthProxy } from "./expo-oauth-proxy";

export function initAuth(options: {
  database: BetterAuthOptions["database"];
  baseUrl: string;
  productionUrl: string;
  secret: string | undefined;
  proxySecret: string;

  discordClientId: string;
  discordClientSecret: string;
}) {
  const config = {
    database: options.database,
    baseURL: options.baseUrl,
    secret: options.secret,
    databaseHooks: DiscordProfileAuth.databaseHooks,
    user: {
      additionalFields: {
        discordUsername: { type: "string", required: false, input: false },
        discordBannerUrl: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
        discordAccentColor: {
          type: "number",
          required: false,
          input: false,
          returned: false,
        },
        discordAvatarDecorationUrl: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
        discordGuildTag: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
        discordGuildBadgeUrl: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
        discordNameplateUrl: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
        discordPublicFlags: {
          type: "number",
          required: false,
          input: false,
          returned: false,
        },
        discordProfileSyncedAt: {
          type: "date",
          required: false,
          input: false,
          returned: false,
        },
        discordProfileRevision: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 400, // 400 days (max cookie lifetime browsers allow)
      updateAge: 60 * 60 * 24 * 30, // roll the window forward on use, at most monthly
    },
    plugins: [
      oAuthProxy({
        currentURL: options.baseUrl,
        productionURL: options.productionUrl,
        secret: options.proxySecret,
      }),
      expoWithOAuthProxy(options.baseUrl, options.productionUrl),
    ],
    socialProviders: {
      discord: {
        clientId: options.discordClientId,
        clientSecret: options.discordClientSecret,
        redirectURI: `${options.productionUrl}/api/auth/callback/discord`,
        mapProfileToUser: DiscordProfileAuth.mapProfileToUser,
        overrideUserInfoOnSignIn: true,
      },
    },
    // The production OAuth proxy also validates the mobile callback scheme.
    trustedOrigins: [
      "whisp://",
      "whisp-preview://",
      "https://whisp-*-augies-projects.vercel.app",
    ],
  } satisfies BetterAuthOptions;

  return betterAuth(config);
}

export type Auth = ReturnType<typeof initAuth>;
export type Session = Auth["$Infer"]["Session"];
