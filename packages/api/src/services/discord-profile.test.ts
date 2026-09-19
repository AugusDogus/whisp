import { createClient } from "@libsql/client";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

import { eq, sql } from "@acme/db";
import * as schema from "@acme/db/schema";

import { DiscordProfile } from "./discord-profile";

const id = "80351110224678912";
const avatar = "8342729096ea3675442027381ff50dfe";
const user = { id, username: "nelly", discriminator: "0", avatar: null };

describe("Discord profile cosmetics", () => {
  test("resolves actual assets and only public badge flags", () => {
    const result = DiscordProfile.parse({
      ...user,
      global_name: "Nelly",
      avatar: `a_${avatar}`,
      banner: `a_${avatar}`,
      accent_color: 0,
      public_flags: (1 << 6) | (1 << 9) | (1 << 19),
      flags: 1,
      avatar_decoration_data: { asset: `a_${avatar}`, sku_id: "123" },
      primary_guild: {
        identity_enabled: true,
        identity_guild_id: "123",
        tag: "DISC",
        badge: avatar,
      },
      collectibles: {
        nameplate: {
          asset: "nameplates/nameplates/twilight/",
          palette: "cobalt",
        },
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      name: "Nelly",
      accentColor: 0,
      avatarUrl: `https://cdn.discordapp.com/avatars/${id}/a_${avatar}.gif?size=256`,
      bannerUrl: `https://cdn.discordapp.com/banners/${id}/a_${avatar}.gif?size=1024`,
      decorationUrl: `https://cdn.discordapp.com/avatar-decoration-presets/a_${avatar}.png`,
      guildTag: {
        tag: "DISC",
        badgeUrl: `https://cdn.discordapp.com/guild-tag-badges/123/${avatar}.webp`,
      },
      nameplateUrl:
        "https://cdn.discordapp.com/assets/collectibles/nameplates/nameplates/twilight/static.png",
      publicFlags: (1 << 6) | (1 << 9) | (1 << 19),
    });
  });

  test("handles absent cosmetics, default avatars, and removed server tags", () => {
    const result = DiscordProfile.parse({
      ...user,
      primary_guild: {
        identity_enabled: false,
        identity_guild_id: "123",
        tag: "DISC",
        badge: avatar,
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      name: "nelly",
      avatarUrl: "https://cdn.discordapp.com/embed/avatars/5.png",
      bannerUrl: null,
      accentColor: null,
      decorationUrl: null,
      guildTag: null,
      nameplateUrl: null,
      publicFlags: 0,
    });
    const legacy = DiscordProfile.parse({ ...user, discriminator: "1337" });
    expect(legacy.success && legacy.data.avatarUrl).toBe(
      "https://cdn.discordapp.com/embed/avatars/2.png",
    );
  });

  test("rejects malformed IDs, asset paths, and colors at the API boundary", () => {
    for (const invalid of [
      { id: "../other" },
      { avatar: "../../other" },
      { accent_color: 0x1000000 },
      { collectibles: { nameplate: { asset: "../other/" } } },
    ]) {
      expect(DiscordProfile.parse({ ...user, ...invalid }).success).toBe(false);
    }
  });
});

const client = createClient({ url: "file::memory:" });
const db = drizzle({ client, schema });
const migration = await Bun.file(
  new URL("../../../db/drizzle/0001_discord_cosmetics.sql", import.meta.url),
).text();
await db.run(sql`CREATE TABLE user (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, discordUsername TEXT, image TEXT,
  updatedAt INTEGER
)`);
await client.executeMultiple(migration);
await db.run(
  sql`CREATE TABLE account (userId TEXT, providerId TEXT, accountId TEXT)`,
);
await db.run(sql`CREATE TABLE friendship (
  id TEXT, userIdA TEXT, userIdB TEXT, createdAt INTEGER, currentStreak INTEGER,
  lastActivityTimestampA INTEGER, lastActivityTimestampB INTEGER, streakUpdatedAt INTEGER
)`);
await db.run(sql`INSERT INTO account VALUES
  ('me', 'other', 'wrong'), ('me', 'discord', ${id}), ('friend', 'discord', ${id})`);
await db.run(
  sql`INSERT INTO friendship (id, userIdA, userIdB) VALUES ('f', 'friend', 'me')`,
);
afterAll(() => client.close());

beforeEach(async () => {
  await db.run(sql`DELETE FROM user`);
  await db.run(sql`INSERT INTO user (id, name, discordUsername, image) VALUES
    ('me', 'My display name', 'old_username', 'https://example.com/old.png'),
    ('friend', 'Friend', NULL, NULL), ('unlinked', 'Unlinked', NULL, NULL)`);
});

describe("Discord profile lookup", () => {
  test("only looks up the linked Discord account for self and friends", async () => {
    for (const target of ["me", "friend"]) {
      const result = await DiscordProfile.refresh(
        db,
        "me",
        target,
        async (discordId) => {
          expect(discordId).toBe(id);
          return user;
        },
      );
      expect(result.success).toBe(true);
    }
  });

  test("rejects strangers and missing accounts before calling Discord", async () => {
    let requests = 0;
    const fetchUser = async () => {
      requests++;
      return user;
    };
    expect(
      await DiscordProfile.refresh(db, "me", "stranger", fetchUser),
    ).toMatchObject({
      success: false,
      code: "FORBIDDEN",
    });
    expect(
      await DiscordProfile.refresh(db, "unlinked", "unlinked", fetchUser),
    ).toMatchObject({
      success: false,
      code: "NOT_FOUND",
    });
    expect(requests).toBe(0);
  });

  test("reports upstream failures and mismatched accounts as errors", async () => {
    for (const fetchUser of [
      async () => {
        throw new Error("unavailable");
      },
      async () => ({ ...user, id: "123" }),
      async () => ({ id }),
    ]) {
      expect(
        await DiscordProfile.refresh(db, "me", "me", fetchUser),
      ).toMatchObject({
        success: false,
        code: "BAD_GATEWAY",
      });
    }
  });
});

describe("persisted Discord profiles", () => {
  const decoratedUser = {
    ...user,
    avatar,
    banner: avatar,
    accent_color: 0xff00ff,
    avatar_decoration_data: { asset: `a_${avatar}` },
    public_flags: 1 << 6,
    primary_guild: {
      identity_enabled: true,
      identity_guild_id: "123",
      tag: "DISC",
      badge: avatar,
    },
    collectibles: { nameplate: { asset: "nameplates/nameplates/twilight/" } },
  };

  test("the migration preserves existing users and avatars", async () => {
    const legacyClient = createClient({ url: "file::memory:" });
    try {
      await legacyClient.execute(
        "CREATE TABLE user (id TEXT PRIMARY KEY, image TEXT)",
      );
      await legacyClient.execute(
        "INSERT INTO user VALUES ('legacy', 'saved-avatar.png')",
      );
      await legacyClient.executeMultiple(migration);
      const { rows } = await legacyClient.execute("SELECT * FROM user");
      expect(rows).toMatchObject([
        {
          id: "legacy",
          image: "saved-avatar.png",
          discordBannerUrl: null,
          discordAccentColor: null,
          discordAvatarDecorationUrl: null,
          discordGuildTag: null,
          discordGuildBadgeUrl: null,
          discordNameplateUrl: null,
          discordPublicFlags: null,
          discordProfileSyncedAt: null,
          discordProfileRevision: null,
        },
      ]);
      expect(rows[0]).not.toHaveProperty("discordCosmetics");
    } finally {
      legacyClient.close();
    }
  });

  test("reads an existing profile without needing Discord", async () => {
    expect(await DiscordProfile.read(db, "me", "me")).toEqual({
      success: true,
      needsRefresh: true,
      profile: {
        name: "My display name",
        username: "old_username",
        avatarUrl: "https://example.com/old.png",
        cosmetics: null,
      },
    });
    expect(await DiscordProfile.read(db, "me", "stranger")).toMatchObject({
      success: false,
      code: "FORBIDDEN",
    });
  });

  test("saves avatar and cosmetics together and shares freshness across viewers", async () => {
    let requests = 0;
    const fetchUser = async () => {
      requests++;
      return decoratedUser;
    };
    const synced = await DiscordProfile.refresh(
      db,
      "me",
      "friend",
      fetchUser,
      "if-stale",
    );
    expect(synced).toMatchObject({ success: true, needsRefresh: false });
    if (!synced.success || synced.profile.cosmetics === null)
      throw new Error("Expected saved Discord cosmetics after refresh");
    expect(synced.profile).toMatchObject({
      name: "Friend",
      username: "nelly",
      avatarUrl: `https://cdn.discordapp.com/avatars/${id}/${avatar}.webp?size=256`,
      cosmetics: {
        bannerUrl: `https://cdn.discordapp.com/banners/${id}/${avatar}.webp?size=1024`,
        accentColor: "#ff00ff",
        decorationUrl: `https://cdn.discordapp.com/avatar-decoration-presets/a_${avatar}.png`,
        badges: ["HypeSquad Bravery"],
      },
    });
    expect(synced.profile.cosmetics.lastSyncedAt).toBeGreaterThan(0);
    expect(await DiscordProfile.read(db, "friend", "friend")).toEqual(synced);
    expect(
      await DiscordProfile.refresh(
        db,
        "friend",
        "friend",
        fetchUser,
        "if-stale",
      ),
    ).toEqual(synced);
    expect(requests).toBe(1);
    const [saved] = await db
      .select({
        image: schema.user.image,
        banner: schema.user.discordBannerUrl,
        accent: schema.user.discordAccentColor,
        decoration: schema.user.discordAvatarDecorationUrl,
        guildTag: schema.user.discordGuildTag,
        guildBadge: schema.user.discordGuildBadgeUrl,
        nameplate: schema.user.discordNameplateUrl,
        publicFlags: schema.user.discordPublicFlags,
        syncedAt: schema.user.discordProfileSyncedAt,
      })
      .from(schema.user)
      .where(eq(schema.user.id, "friend"));
    expect(saved).toEqual({
      image: synced.profile.avatarUrl,
      banner: synced.profile.cosmetics.bannerUrl,
      accent: 0xff00ff,
      decoration: synced.profile.cosmetics.decorationUrl,
      guildTag: "DISC",
      guildBadge: `https://cdn.discordapp.com/guild-tag-badges/123/${avatar}.webp`,
      nameplate:
        "https://cdn.discordapp.com/assets/collectibles/nameplates/nameplates/twilight/static.png",
      publicFlags: 1 << 6,
      syncedAt: new Date(synced.profile.cosmetics.lastSyncedAt),
    });
  });

  test("derives display colors and badges from the stored integers", async () => {
    await db
      .update(schema.user)
      .set({
        discordAccentColor: 0,
        discordPublicFlags: (1 << 6) | (1 << 9) | (1 << 19),
        discordProfileSyncedAt: new Date(),
      })
      .where(eq(schema.user.id, "me"));
    expect(await DiscordProfile.read(db, "me", "me")).toMatchObject({
      success: true,
      profile: {
        cosmetics: {
          accentColor: "#000000",
          badges: ["HypeSquad Bravery", "Early Nitro Supporter"],
        },
      },
    });
  });

  test("keeps all saved data and the sync timestamp when Discord fails", async () => {
    const saved = await DiscordProfile.refresh(
      db,
      "me",
      "me",
      async () => decoratedUser,
    );
    for (const fetchUser of [
      async () => {
        throw new Error("Discord unavailable");
      },
      async () => ({ ...user, id: "123" }),
      async () => ({ id }),
    ]) {
      expect(
        await DiscordProfile.refresh(db, "me", "me", fetchUser),
      ).toMatchObject({
        success: false,
        code: "BAD_GATEWAY",
      });
      expect(await DiscordProfile.read(db, "me", "me")).toEqual(saved);
    }
  });

  test("refreshes stale profiles and clears cosmetics removed on Discord", async () => {
    const saved = await DiscordProfile.refresh(
      db,
      "me",
      "me",
      async () => decoratedUser,
    );
    if (!saved.success || !saved.profile.cosmetics)
      throw new Error("Expected a persisted profile");
    await db
      .update(schema.user)
      .set({
        discordProfileSyncedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      })
      .where(eq(schema.user.id, "me"));
    expect(await DiscordProfile.read(db, "me", "me")).toMatchObject({
      needsRefresh: true,
    });
    const refreshed = await DiscordProfile.refresh(
      db,
      "me",
      "me",
      async () => user,
      "if-stale",
    );
    expect(refreshed).toMatchObject({
      success: true,
      needsRefresh: false,
      profile: {
        cosmetics: {
          bannerUrl: null,
          accentColor: null,
          decorationUrl: null,
          guildTag: null,
          nameplateUrl: null,
          badges: [],
        },
      },
    });
    expect(await DiscordProfile.read(db, "me", "me")).toEqual(refreshed);
  });

  test("explicit avatar refresh updates fresh cosmetics too", async () => {
    await DiscordProfile.refresh(db, "me", "me", async () => decoratedUser);
    const refreshed = await DiscordProfile.refresh(
      db,
      "me",
      "me",
      async () => user,
    );
    expect(refreshed).toMatchObject({
      success: true,
      profile: { cosmetics: { bannerUrl: null, decorationUrl: null } },
    });
  });

  test("a failed database write cannot save only the new avatar", async () => {
    const before = await DiscordProfile.read(db, "me", "me");
    await db.run(sql`CREATE TRIGGER reject_profile BEFORE UPDATE ON user
      BEGIN SELECT RAISE(ABORT, 'Simulated write failure'); END`);
    try {
      await expect(
        DiscordProfile.refresh(db, "me", "me", async () => decoratedUser),
      ).rejects.toThrow();
      expect(await DiscordProfile.read(db, "me", "me")).toEqual(before);
    } finally {
      await db.run(sql`DROP TRIGGER reject_profile`);
    }
  });

  test.each([false, true])(
    "an older in-flight refresh cannot replace a newer saved profile (already synced: %s)",
    async (alreadySynced) => {
      if (alreadySynced)
        await DiscordProfile.refresh(db, "me", "me", async () => user);
      const started = Promise.withResolvers<void>();
      const oldResponse = Promise.withResolvers<unknown>();
      const older = DiscordProfile.refresh(db, "me", "me", async () => {
        started.resolve();
        return oldResponse.promise;
      });
      await started.promise;
      const newer = await DiscordProfile.refresh(
        db,
        "me",
        "me",
        async () => decoratedUser,
      );
      oldResponse.resolve(user);
      expect(await older).toEqual(newer);
      expect(await DiscordProfile.read(db, "me", "me")).toEqual(newer);
    },
  );
});
