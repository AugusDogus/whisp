import { createClient } from "@libsql/client";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { z } from "zod/v4";

import * as schema from "@acme/db/schema";

import { DiscordProfile } from "../services/discord-profile";

const client = createClient({ url: "file::memory:" });
const db = drizzle({ client, schema });
await client.executeMultiple(`
  CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, discordUsername TEXT,
    email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL, image TEXT,
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
    notifyOnMessages INTEGER NOT NULL DEFAULT 1, notifyOnFriendActivity INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL,
    userId TEXT NOT NULL, accessToken TEXT, refreshToken TEXT, idToken TEXT,
    accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT,
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
  CREATE TABLE session (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT UNIQUE NOT NULL,
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL);
  CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
    expiresAt INTEGER NOT NULL, createdAt INTEGER, updatedAt INTEGER);
`);
await client.executeMultiple(
  await Bun.file(
    new URL("../../../db/drizzle/0001_discord_cosmetics.sql", import.meta.url),
  ).text(),
);

const { initAuth } = await import("@acme/auth");
const auth = initAuth({
  database: drizzleAdapter(db, { provider: "sqlite" }),
  proxySecret: "test-only-proxy-secret-with-at-least-thirty-two-characters",
  baseUrl: "http://localhost:3000",
  productionUrl: "http://localhost:3000",
  secret: "test-only-secret-with-at-least-thirty-two-characters",
  discordClientId: "test-client",
  discordClientSecret: "test-secret",
});

const id = "80351110224678912";
const hash = "8342729096ea3675442027381ff50dfe";
const baseProfile = {
  id,
  username: "nelly",
  global_name: "Nelly",
  discriminator: "0",
  email: "nelly@example.com",
  verified: true,
  avatar: hash,
};
let discordResponse: unknown = baseProfile;
const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
  Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const url = decodeURIComponent(
        input instanceof Request ? input.url : String(input),
      );
      if (url === "https://discord.com/api/oauth2/token") {
        return Response.json({
          access_token: "test-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "identify email",
        });
      }
      if (url === "https://discord.com/api/users/@me")
        return Response.json(discordResponse);
      throw new Error(
        `Unexpected network request in sign-in test: ${new URL(url).origin}`,
      );
    },
    { preconnect: globalThis.fetch.preconnect },
  ),
);

async function signIn() {
  const start = await auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/social", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        provider: "discord",
        callbackURL: "http://localhost:3000/done",
      }),
    }),
  );
  expect(start.status).toBe(200);
  const { url } = z.object({ url: z.url() }).parse(await start.json());
  const state = new URL(url).searchParams.get("state");
  if (!state) throw new Error("OAuth response did not include state");
  const cookie = start.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return auth.handler(
    new Request(
      `http://localhost:3000/api/auth/callback/discord?code=test-code&state=${encodeURIComponent(state)}`,
      {
        headers: { Cookie: cookie },
      },
    ),
  );
}

afterAll(() => {
  fetchMock.mockRestore();
  client.close();
});

describe("Discord OAuth profile persistence", () => {
  test("signup persists cosmetics and a later sign-in clears removed cosmetics", async () => {
    discordResponse = {
      ...baseProfile,
      banner: hash,
      accent_color: 0,
      avatar_decoration_data: { asset: `a_${hash}` },
      public_flags: 1 << 6,
      primary_guild: {
        identity_enabled: true,
        identity_guild_id: "123",
        tag: "DISC",
        badge: hash,
      },
      collectibles: { nameplate: { asset: "nameplates/nameplates/twilight/" } },
    };
    expect((await signIn()).status).toBe(302);
    const [created] = await db.select().from(schema.user);
    expect(created).toMatchObject({
      name: "Nelly",
      discordUsername: "nelly",
      discordAccentColor: 0,
      discordPublicFlags: 1 << 6,
      discordGuildTag: "DISC",
      discordGuildBadgeUrl: `https://cdn.discordapp.com/guild-tag-badges/123/${hash}.webp`,
      discordBannerUrl: `https://cdn.discordapp.com/banners/${id}/${hash}.webp?size=1024`,
      discordAvatarDecorationUrl: `https://cdn.discordapp.com/avatar-decoration-presets/a_${hash}.png`,
      discordNameplateUrl:
        "https://cdn.discordapp.com/assets/collectibles/nameplates/nameplates/twilight/static.png",
    });
    expect(created?.discordProfileSyncedAt).toBeInstanceOf(Date);
    expect(typeof created?.discordProfileRevision).toBe("string");

    discordResponse = { ...baseProfile, avatar: null, username: "new_name" };
    expect((await signIn()).status).toBe(302);
    const [updated] = await db.select().from(schema.user);
    expect(updated).toMatchObject({
      id: created?.id,
      discordUsername: "new_name",
      image: "https://cdn.discordapp.com/embed/avatars/5.png",
      discordBannerUrl: null,
      discordAccentColor: null,
      discordAvatarDecorationUrl: null,
      discordGuildTag: null,
      discordGuildBadgeUrl: null,
      discordNameplateUrl: null,
      discordPublicFlags: 0,
    });
    expect(updated?.discordProfileRevision).not.toBe(
      created?.discordProfileRevision,
    );
  });

  test("invalid Discord data does not overwrite the saved profile during sign-in", async () => {
    discordResponse = { ...baseProfile, banner: hash };
    expect((await signIn()).status).toBe(302);
    const before = await db.select().from(schema.user);
    discordResponse = { ...baseProfile, avatar: null, banner: "invalid-asset" };
    expect((await signIn()).status).toBe(502);
    expect(await db.select().from(schema.user)).toEqual(before);
  });

  test("client updates cannot alter server-managed Discord fields", async () => {
    discordResponse = { ...baseProfile, banner: hash, accent_color: 123 };
    const signedIn = await signIn();
    expect(signedIn.status).toBe(302);
    const cookie = signedIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const before = await db.select().from(schema.user);
    for (const fields of [
      {
        discordUsername: "spoofed",
        discordBannerUrl: "https://example.com/fake.png",
        discordPublicFlags: 1,
      },
      {
        discordUsername: "",
        discordBannerUrl: null,
        discordAccentColor: 0,
        discordProfileRevision: null,
      },
    ]) {
      const response = await auth.handler(
        new Request("http://localhost:3000/api/auth/update-user", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
            Cookie: cookie,
          },
          body: JSON.stringify(fields),
        }),
      );
      expect(response.status).toBe(400);
      expect(await db.select().from(schema.user)).toEqual(before);
    }
  });

  test("sign-in wins over a refresh that was already fetching older data", async () => {
    discordResponse = baseProfile;
    await signIn();
    const [saved] = await db.select().from(schema.user);
    if (!saved) throw new Error("Expected a signed-in user");
    const started = Promise.withResolvers<void>();
    const oldResponse = Promise.withResolvers<unknown>();
    const oldRefresh = DiscordProfile.refresh(
      db,
      saved.id,
      saved.id,
      async () => {
        started.resolve();
        return oldResponse.promise;
      },
    );
    await started.promise;
    discordResponse = { ...baseProfile, banner: hash, accent_color: 0 };
    await signIn();
    const signedIn = await DiscordProfile.read(db, saved.id, saved.id);
    oldResponse.resolve(baseProfile);
    expect(await oldRefresh).toEqual(signedIn);
    expect(await DiscordProfile.read(db, saved.id, saved.id)).toEqual(signedIn);
  });
});
