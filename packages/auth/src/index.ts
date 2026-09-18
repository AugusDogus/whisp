import type { BetterAuthOptions } from "better-auth";

import { betterAuth } from "better-auth";
import { oAuthProxy } from "better-auth/plugins";

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
    user: {
      additionalFields: {
        discordUsername: { type: "string", required: false, input: false },
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
        mapProfileToUser: (profile: { username: string }) => ({
          discordUsername: profile.username,
        }),
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
