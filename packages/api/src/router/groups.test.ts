import { createClient } from "@libsql/client";
import { initTRPC } from "@trpc/server";
import { afterAll, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@acme/db/schema";

import { Blocking } from "../services/blocking";
import { createSafetyTestDatabase } from "../services/safety-test-fixture";

const client = createClient({ url: ":memory:" });
let queries = 0;
const db = drizzle({ client, schema, logger: { logQuery: () => queries++ } });
const t = initTRPC
  .context<{ db: typeof db; session: { user: { id: string } } }>()
  .create();
mock.module("../trpc", () => ({
  protectedProcedure: t.procedure,
  sharingProcedure: t.procedure,
}));
const { groupsRouter } = await import("./groups");
const caller = t.router(groupsRouter).createCaller({
  db,
  session: { user: { id: "me" } },
});

await client.executeMultiple(`
  CREATE TABLE user (id TEXT PRIMARY KEY, image TEXT);
  CREATE TABLE "group" (id TEXT PRIMARY KEY, name TEXT, createdById TEXT, createdAt INTEGER);
  CREATE TABLE group_member (id TEXT, groupId TEXT, userId TEXT, joinedAt INTEGER);
  CREATE TABLE message (id TEXT PRIMARY KEY, senderId TEXT, groupId TEXT, fileUrl TEXT, mimeType TEXT, thumbhash TEXT, createdAt INTEGER, deletedAt INTEGER);
  CREATE TABLE message_delivery (id TEXT PRIMARY KEY, messageId TEXT, recipientId TEXT, groupId TEXT, readAt INTEGER);
  CREATE TABLE user_block (blockerId TEXT, blockedId TEXT, createdAt INTEGER);
  CREATE TABLE account_suspension (userId TEXT PRIMARY KEY, createdAt INTEGER, enforcementId TEXT, expiresAt INTEGER);
  INSERT INTO user VALUES ('me', NULL), ('friend', 'avatar');
  INSERT INTO "group" VALUES ('ours', 'Our group', 'me', 1), ('other', 'Other group', 'friend', 1);
  INSERT INTO group_member VALUES ('a', 'ours', 'me', 1), ('b', 'ours', 'friend', 1);
  INSERT INTO message VALUES
    ('incoming', 'friend', 'ours', 'encrypted', 'application/vnd.whisp.mls.v1', NULL, 3, NULL),
    ('read', 'friend', 'ours', 'photo', 'image/jpeg', NULL, 2, NULL),
    ('other-message', 'friend', 'other', 'private', 'image/jpeg', NULL, 4, NULL);
  INSERT INTO message_delivery VALUES
    ('unread', 'incoming', 'me', 'ours', NULL),
    ('viewed', 'read', 'me', 'ours', 4),
    ('other-recipient', 'incoming', 'friend', 'ours', NULL),
    ('other-group', 'other-message', 'me', 'other', NULL);
`);
afterAll(() => {
  mock.restore();
  client.close();
});

test("group inbox authorizes membership then reads unread messages in one joined query", async () => {
  queries = 0;
  expect(await caller.inbox({ groupId: "ours" })).toEqual([
    {
      deliveryId: "unread",
      messageId: "incoming",
      senderId: "friend",
      fileUrl: "encrypted",
      mimeType: "application/vnd.whisp.mls.v1",
      thumbhash: undefined,
      createdAt: new Date(3000),
    },
  ]);
  expect(queries).toBe(2);
  queries = 0;
  expect(await caller.inbox({ groupId: "other" })).toEqual([]);
  expect(queries).toBe(1);
});

test("group list preserves unread counts, avatars, and latest activity within memberships", async () => {
  expect(await caller.list()).toEqual([
    {
      id: "ours",
      name: "Our group",
      memberCount: 2,
      memberAvatars: [
        { userId: "me", image: null },
        { userId: "friend", image: "avatar" },
      ],
      lastMessageAt: new Date(3000),
      lastSentByMe: false,
      unreadCount: 1,
    },
  ]);
});

// Uses the full migrated schema, seeded with alice, bob, and carol.
const safetyDatabase = await createSafetyTestDatabase();
const safetyCaller = (userId: string) =>
  t
    .router(groupsRouter)
    .createCaller({ db: safetyDatabase, session: { user: { id: userId } } });

test("blocked group renames cannot change the name returned to the blocker", async () => {
  await safetyDatabase
    .insert(schema.Group)
    .values({ id: "shared", name: "Friends", createdById: "alice" });
  await safetyDatabase.insert(schema.GroupMember).values(
    ["alice", "bob", "carol"].map((userId) => ({
      userId,
      groupId: "shared",
    })),
  );
  await safetyDatabase.transaction((tx) => Blocking.block(tx, "alice", "bob"));
  await expect(
    safetyCaller("bob").rename({ groupId: "shared", name: "Unwanted contact" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    (await safetyCaller("alice").list()).map((group) => group.name),
  ).toEqual(["Friends"]);
  await safetyCaller("carol").rename({ groupId: "shared", name: "Holiday" });
  expect(
    (await safetyCaller("alice").list()).map((group) => group.name),
  ).toEqual(["Holiday"]);
});
