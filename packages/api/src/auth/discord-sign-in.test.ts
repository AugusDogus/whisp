import { createClient } from "@libsql/client";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod/v4";

import { Enforcement } from "@acme/db/enforcement";
import * as schema from "@acme/db/schema";
import { CONTENT_POLICY_VERSION } from "@acme/validators";

import { AccountDeletion } from "../services/account-deletion";
import { ContentAccess } from "../services/content-access";
import { DiscordProfile } from "../services/discord-profile";
import { Moderation } from "../services/moderation";

const directory = mkdtempSync(join(tmpdir(), "whisp-sign-in-"));
const client = createClient({ url: `file:${join(directory, "test.db")}` });
const db = drizzle({ client, schema });
for (const name of [
  "0000_baseline",
  "0001_discord_cosmetics",
  "0002_push_token_sessions",
  "0003_account_safety",
  "0004_account_lifecycle",
  "0005_file_deletion_attempts",
]) {
  await client.executeMultiple(
    await Bun.file(
      new URL(`../../../db/drizzle/${name}.sql`, import.meta.url),
    ).text(),
  );
}
const config = {
  key: "test-enforcement-key-at-least-32-characters",
  policyVersion: "test-policy",
};

const { initAuth } = await import("@acme/auth");
const auth = initAuth({
  enforceAccount: async (userId) => {
    const result = await Enforcement.apply(db, config, userId);
    if (result.status !== "ready")
      throw new Error(`Safety check failed: ${result.status}`);
  },
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
  rmSync(directory, { recursive: true });
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

test("Better Auth logout deletes the session's push registration without contacting Expo", async () => {
  discordResponse = baseProfile;
  const response = await signIn();
  const headers = new Headers({
    Cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
    Origin: "http://localhost:3000",
  });
  const signedIn = await auth.api.getSession({ headers });
  if (!signedIn) throw new Error("Expected an authenticated OAuth session");
  await db.insert(schema.PushToken).values({
    userId: signedIn.user.id,
    sessionId: signedIn.session.id,
    token: "logout-device",
    platform: "ios",
  });
  const logout = await auth.handler(
    new Request("http://localhost:3000/api/auth/sign-out", {
      method: "POST",
      headers,
    }),
  );
  expect(logout.status).toBe(200);
  expect(await db.query.PushToken.findMany()).toHaveLength(0);
  expect(await auth.api.getSession({ headers })).toBeNull();
});

test("real Discord re-registration preserves only the reviewed unexpired enforcement", async () => {
  discordResponse = baseProfile;
  await signIn();
  const [original] = await db.select().from(schema.user);
  if (!original) throw new Error("Expected signed-in user");
  await db.insert(schema.user).values({
    id: "reporter",
    name: "Reporter",
    email: "reporter@example.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(schema.AbuseReport).values({
    id: "serious",
    reporterId: "reporter",
    reportedUserId: original.id,
    reason: "harassment",
    details: "Sensitive allegation",
  });
  const expiresAt = new Date(Date.now() + 86400_000).toISOString();
  const result = await Moderation.resolve(
    db,
    "serious",
    {
      action: "enforce",
      expiresAt,
      reason: "repeated_severe_harassment",
      confirmedSeriousAbuse: true,
      necessaryDespiteDeletion: true,
      shorterPeriodInsufficient: true,
      rightsAndAgeConsidered: true,
    },
    config,
  );
  expect(result.status).toBe("resolved");
  const decisions = await db.select().from(schema.AbuseEnforcement);
  await AccountDeletion.remove(db, original.id, undefined);
  expect(await db.select().from(schema.account)).toHaveLength(0);
  expect(await db.select().from(schema.session)).toHaveLength(0);
  expect(await db.select().from(schema.AbuseReport)).toHaveLength(0);
  expect(await db.select().from(schema.AbuseEnforcement)).toEqual(decisions);
  expect(JSON.stringify(decisions)).not.toContain(id);
  expect(JSON.stringify(decisions)).not.toContain("nelly");
  expect(JSON.stringify(decisions)).not.toContain("Sensitive allegation");
  expect((await signIn()).status).toBe(302);
  const [linked] = await db.select().from(schema.account);
  if (!linked) throw new Error("Expected recreated Discord account");
  expect(linked.userId).not.toBe(original.id);
  await db
    .insert(schema.ContentPolicyAcceptance)
    .values({ userId: linked.userId, version: CONTENT_POLICY_VERSION });
  expect(await ContentAccess.status(db, linked.userId)).toEqual({
    status: "suspended",
  });
  await signIn();
  expect(await db.select().from(schema.AbuseEnforcement)).toEqual(decisions);
  await Moderation.restore(db, linked.userId);
  expect(await db.select().from(schema.AbuseEnforcement)).toHaveLength(0);
  expect(await ContentAccess.status(db, linked.userId)).toEqual({
    status: "allowed",
  });
  await AccountDeletion.remove(db, linked.userId, undefined);
  await signIn();
  expect(await db.select().from(schema.AbuseEnforcement)).toHaveLength(0);
  expect(await db.select().from(schema.AccountSuspension)).toHaveLength(0);
});
