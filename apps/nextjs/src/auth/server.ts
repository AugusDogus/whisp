import "server-only";
import { cache } from "react";

import { headers } from "next/headers";

import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { initAuth } from "@acme/auth";
import { db } from "@acme/db/client";

import { env } from "~/env";

const baseUrl =
  env.VERCEL_ENV === "production"
    ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
    : env.VERCEL_ENV === "preview"
      ? `https://${env.VERCEL_URL}`
      : env.LOCAL_URL;

export const auth = initAuth({
  database: drizzleAdapter(db, { provider: "sqlite" }),
  baseUrl,
  productionUrl: env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
    : env.LOCAL_URL,
  secret: env.AUTH_SECRET,
  proxySecret: env.OAUTH_PROXY_SECRET,
  discordClientId: env.AUTH_DISCORD_ID,
  discordClientSecret: env.AUTH_DISCORD_SECRET,
});

export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);
