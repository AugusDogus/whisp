import { createClient } from "@libsql/client";
import { initTRPC } from "@trpc/server";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

import { sql } from "@acme/db";
import * as schema from "@acme/db/schema";

const client = createClient({ url: "file::memory:" });
const db = drizzle({ client, schema });
const t = initTRPC
  .context<{ db: typeof db; session: { user: { id: string } } }>()
  .create();

mock.module("../trpc", () => ({ protectedProcedure: t.procedure }));
const { friendsRouter } = await import("./friends");
const caller = t.router(friendsRouter).createCaller({
  db,
  session: { user: { id: "me" } },
});

await db.run(sql`CREATE TABLE user (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, discordUsername TEXT, email TEXT,
  emailVerified INTEGER, image TEXT, createdAt INTEGER, updatedAt INTEGER,
  notifyOnMessages INTEGER, notifyOnFriendActivity INTEGER
)`);
await client.executeMultiple(
  await Bun.file(
    new URL("../../../db/drizzle/0001_discord_cosmetics.sql", import.meta.url),
  ).text(),
);
await db.run(sql`CREATE TABLE friendship (
  id TEXT, userIdA TEXT, userIdB TEXT, createdAt INTEGER, currentStreak INTEGER,
  lastActivityTimestampA INTEGER, lastActivityTimestampB INTEGER, streakUpdatedAt INTEGER
)`);
await db.run(sql`CREATE TABLE friend_request (
  id TEXT, fromUserId TEXT, toUserId TEXT, status TEXT, createdAt INTEGER, updatedAt INTEGER
)`);
await client.executeMultiple(`
  CREATE TABLE account (id TEXT, userId TEXT, providerId TEXT, accountId TEXT);
  CREATE TABLE message (id TEXT, senderId TEXT, mimeType TEXT);
  CREATE TABLE message_delivery (
    id TEXT, messageId TEXT, recipientId TEXT, groupId TEXT, readAt INTEGER, createdAt INTEGER
  );
`);

beforeEach(async () => {
  await db.delete(schema.FriendRequest);
  await db.delete(schema.Friendship);
  await db.delete(schema.user);
  await db.run(sql`INSERT INTO user (id, name, discordUsername, image) VALUES
    ('me', 'Self Display', 'fixture_self', NULL),
    ('friend', 'Friend Display', 'fixture_friend', 'https://example.com/avatar.png'),
    ('unrelated', 'fixture_friend', 'another_username', NULL),
    ('legacy', 'legacy', NULL, NULL)`);
});

afterAll(() => {
  mock.restore();
  client.close();
});

describe("friend search by Discord username", () => {
  test("finds a username that differs from the display name", async () => {
    expect(await caller.searchUsers({ query: "fixture_friend" })).toEqual([
      {
        id: "friend",
        name: "Friend Display",
        image: "https://example.com/avatar.png",
        isFriend: false,
        hasPendingRequest: false,
      },
    ]);
  });

  test("ignores capitalization and surrounding whitespace", async () => {
    expect(
      (await caller.searchUsers({ query: "  FiXtUrE_FrIeNd  " })).map(
        (u) => u.id,
      ),
    ).toEqual(["friend"]);
  });

  test("does not match display names, partial names, or wildcards", async () => {
    for (const query of [
      "Friend Display",
      "fixture",
      "m",
      "%",
      "_",
      "fixture%",
      "*",
      "legacy",
    ])
      expect(await caller.searchUsers({ query })).toEqual([]);
  });

  test("treats underscores in usernames literally", async () => {
    expect(
      (await caller.searchUsers({ query: "another_username" })).map(
        (u) => u.id,
      ),
    ).toEqual(["unrelated"]);
    expect(await caller.searchUsers({ query: "another%username" })).toEqual([]);
  });

  test("rejects blank searches and excludes the signed-in user", async () => {
    for (const query of ["", " ", "\t\n"])
      await expect(caller.searchUsers({ query })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    expect(await caller.searchUsers({ query: "fixture_self" })).toEqual([]);
  });

  test("preserves friendship and pending-request status", async () => {
    await db.run(
      sql`INSERT INTO friendship (id, userIdA, userIdB) VALUES ('f', 'friend', 'me')`,
    );
    expect(await caller.searchUsers({ query: "fixture_friend" })).toMatchObject(
      [{ isFriend: true }],
    );
    await db.delete(schema.Friendship);
    await db.run(sql`INSERT INTO friend_request (id, fromUserId, toUserId, status)
      VALUES ('r', 'me', 'friend', 'pending')`);
    expect(await caller.searchUsers({ query: "fixture_friend" })).toMatchObject(
      [{ hasPendingRequest: true }],
    );
  });
});

test("the friend list includes saved cosmetics and freshness before opening a profile", async () => {
  await db.run(
    sql`INSERT INTO friendship (id, userIdA, userIdB) VALUES ('f', 'friend', 'me')`,
  );
  await db.run(sql`UPDATE user SET discordBannerUrl = 'https://example.com/banner.png',
    discordAccentColor = 16711680, discordProfileSyncedAt = ${Math.floor(Date.now() / 1000)}
    WHERE id = 'friend'`);
  const friends = await caller.list();
  expect(friends.map((friend) => friend.id)).toEqual(["friend"]);
  expect(friends[0]?.discordProfile).toMatchObject({
    needsRefresh: false,
    profile: {
      name: "Friend Display",
      username: "fixture_friend",
      avatarUrl: "https://example.com/avatar.png",
      cosmetics: {
        bannerUrl: "https://example.com/banner.png",
        accentColor: "#ff0000",
      },
    },
  });
  await db.run(
    sql`UPDATE user SET discordProfileSyncedAt = NULL WHERE id = 'friend'`,
  );
  expect((await caller.list())[0]?.discordProfile).toMatchObject({
    needsRefresh: true,
    profile: { cosmetics: null },
  });
});
