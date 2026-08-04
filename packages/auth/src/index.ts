import type { BetterAuthOptions } from "better-auth";

import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { oAuthProxy } from "better-auth/plugins";

import { db } from "@acme/db/client";

export function initAuth(options: {
  baseUrl: string;
  productionUrl: string;
  secret: string | undefined;

  discordClientId: string;
  discordClientSecret: string;
}) {
  const config = {
    database: drizzleAdapter(db, {
      provider: "sqlite",
    }),
    baseURL: options.baseUrl,
    secret: options.secret,
    session: {
      expiresIn: 60 * 60 * 24 * 400, // 400 days (max cookie lifetime browsers allow)
      updateAge: 60 * 60 * 24 * 30, // roll the window forward on use, at most monthly
    },
    plugins: [
      oAuthProxy({
        /**
         * Auto-inference blocked by https://github.com/better-auth/better-auth/pull/2891
         */
        currentURL: options.baseUrl,
        productionURL: options.productionUrl,
      }),
      expo(),
    ],
    socialProviders: {
      discord: {
        clientId: options.discordClientId,
        clientSecret: options.discordClientSecret,
        redirectURI: `${options.productionUrl}/api/auth/callback/discord`,
      },
    },
    trustedOrigins: ["whisp://"],
  } satisfies BetterAuthOptions;

  return betterAuth(config);
}

export type Auth = ReturnType<typeof initAuth>;
export type Session = Auth["$Infer"]["Session"];
