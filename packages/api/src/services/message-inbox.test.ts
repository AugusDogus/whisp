import { createClient } from "@libsql/client";
import { afterAll, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@acme/db/schema";

import { getMessageInbox } from "./message-inbox";

const client = createClient({ url: ":memory:" });
let queries = 0;
const database = drizzle({
  client,
  schema,
  logger: { logQuery: () => queries++ },
});
await client.executeMultiple(`
  CREATE TABLE message (id TEXT PRIMARY KEY, senderId TEXT, fileUrl TEXT, mimeType TEXT, thumbhash TEXT, createdAt INTEGER);
  CREATE TABLE message_delivery (id TEXT PRIMARY KEY, messageId TEXT, recipientId TEXT, groupId TEXT, readAt INTEGER);
  CREATE TABLE user_block (blockerId TEXT, blockedId TEXT, createdAt INTEGER);
  CREATE TABLE account_suspension (userId TEXT PRIMARY KEY, createdAt INTEGER, enforcementId TEXT, expiresAt INTEGER);
  CREATE TABLE mls_draft_conversation (draftId TEXT, conversationId TEXT);
  CREATE TABLE mls_conversation (id TEXT PRIMARY KEY, scope TEXT, groupId TEXT, users TEXT, revision INTEGER, epoch INTEGER, members TEXT);
  INSERT INTO message VALUES
    ('multi', 'alice', 'https://example.test/encrypted', 'application/vnd.whisp.mls.v1', NULL, 10),
    ('old', 'alice', 'https://example.test/old', 'application/vnd.whisp.mls.v1', NULL, 9),
    ('legacy', 'alice', 'https://example.test/photo', 'image/jpeg', NULL, 8),
    ('group', 'alice', 'https://example.test/group', 'application/vnd.whisp.mls.v1', NULL, 7);
  INSERT INTO message_delivery VALUES
    ('self', 'multi', 'alice', NULL, NULL),
    ('peer', 'multi', 'bob', NULL, NULL),
    ('viewed', 'multi', 'carol', NULL, 11),
    ('old-peer', 'old', 'bob', NULL, NULL),
    ('legacy-peer', 'legacy', 'bob', NULL, NULL),
    ('group-peer', 'group', 'bob', 'group-1', NULL);
`);
for (const [id, scope] of [
  ["self-session", JSON.stringify(["direct", "alice", "alice"])],
  ["peer-session", JSON.stringify(["direct", "alice", "bob"])],
  ["unrelated-session", JSON.stringify(["direct", "alice", "carol"])],
  [
    "retired-session",
    JSON.stringify([
      "retired",
      JSON.stringify(["direct", "alice", "bob"]),
      "retired-session",
    ]),
  ],
] as const) {
  await client.execute({
    sql: "INSERT INTO mls_conversation VALUES (?, ?, NULL, '[]', 2, 1, '[]')",
    args: [id, scope],
  });
}
await client.executeMultiple(`
  INSERT INTO mls_draft_conversation VALUES
    ('multi', 'unrelated-session'), ('multi', 'self-session'), ('multi', 'peer-session'),
    ('old', 'retired-session');
`);
afterAll(() => client.close());

test("inbox supplies the exact direct session for each recipient without per-row queries", async () => {
  queries = 0;
  const inbox = await getMessageInbox(database, "bob");
  expect(queries).toBe(2);
  expect(inbox.find((d) => d.deliveryId === "peer")?.conversationId).toBe(
    "peer-session",
  );
  expect(inbox.find((d) => d.deliveryId === "old-peer")?.conversationId).toBe(
    "retired-session",
  );
  expect(
    inbox.find((d) => d.deliveryId === "legacy-peer")?.conversationId,
  ).toBeUndefined();
  expect(
    inbox.find((d) => d.deliveryId === "group-peer")?.conversationId,
  ).toBeUndefined();
  expect((await getMessageInbox(database, "alice"))[0]?.conversationId).toBe(
    "self-session",
  );
});

test("inbox excludes viewed deliveries and other accounts", async () => {
  expect(await getMessageInbox(database, "carol")).toEqual([]);
  expect(await getMessageInbox(database, "outsider")).toEqual([]);
});
