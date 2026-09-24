import { createClient } from "@libsql/client";
import { initTRPC } from "@trpc/server";
import { afterAll, beforeEach, mock } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as schema from "@acme/db/schema";

const directory = await mkdtemp(join(tmpdir(), "whisp-mls-test-"));
const client = createClient({ url: `file:${join(directory, "test.db")}` });
const metrics = { queryCount: 0 };
const db = drizzle({
  client,
  schema,
  logger: {
    logQuery: () => {
      metrics.queryCount++;
    },
  },
});
const t = initTRPC
  .context<{ db: typeof db; session: { user: { id: string } } }>()
  .create();
mock.module("../../trpc", () => ({ protectedProcedure: t.procedure }));
const { mlsRouter } = await import("../../router/mls");
const router = t.router(mlsRouter);
type Caller = ReturnType<typeof router.createCaller>;
const sender: Caller = router.createCaller({
  db,
  session: { user: { id: "alice" } },
});
const receiver: Caller = router.createCaller({
  db,
  session: { user: { id: "bob" } },
});
const outsider: Caller = router.createCaller({
  db,
  session: { user: { id: "mallory" } },
});
const senderDevice = crypto.randomUUID();
const recipientDevice = crypto.randomUUID();
const signatureKey = Buffer.alloc(32, 1).toString("base64");
const wire = Buffer.from("native-validated-wire").toString("base64");
await client.executeMultiple(`
PRAGMA foreign_keys = ON;
CREATE TABLE user (id TEXT PRIMARY KEY);
CREATE TABLE friendship (id TEXT PRIMARY KEY, userIdA TEXT, userIdB TEXT, createdAt INTEGER, currentStreak INTEGER, lastActivityTimestampA INTEGER, lastActivityTimestampB INTEGER, streakUpdatedAt INTEGER);
CREATE TABLE group_member (id TEXT PRIMARY KEY, groupId TEXT, userId TEXT, joinedAt INTEGER);
CREATE TABLE message_delivery (id TEXT PRIMARY KEY, messageId TEXT, recipientId TEXT, groupId TEXT, createdAt INTEGER, readAt INTEGER);
`);
await client.executeMultiple(
  await Bun.file(
    new URL("../../../../db/drizzle/0002_mls.sql", import.meta.url),
  ).text(),
);
await client.executeMultiple(
  await Bun.file(
    new URL(
      "../../../../db/drizzle/0003_mls_device_names.sql",
      import.meta.url,
    ),
  ).text(),
);
await client.executeMultiple(
  await Bun.file(
    new URL(
      "../../../../db/drizzle/0004_mls_application_epochs.sql",
      import.meta.url,
    ),
  ).text(),
);
beforeEach(async () => {
  await client.executeMultiple(
    "DELETE FROM mls_draft; DELETE FROM mls_conversation; DELETE FROM mls_key_package; DELETE FROM mls_device; DELETE FROM friendship; DELETE FROM group_member; DELETE FROM message_delivery; DELETE FROM user; INSERT INTO user VALUES ('alice'), ('bob'), ('mallory');",
  );
  await db
    .insert(schema.Friendship)
    .values({ userIdA: "alice", userIdB: "bob" });
  await sender.register({ deviceId: senderDevice, signatureKey });
  await receiver.register({ deviceId: recipientDevice, signatureKey });
  await receiver.publish({
    deviceId: recipientDevice,
    packages: Array.from({ length: 4 }, () => ({
      id: crypto.randomUUID(),
      data: wire,
    })),
  });
});
afterAll(async () => {
  mock.restore();
  client.close();
  await rm(directory, { recursive: true });
});

async function prepare(groupId?: string) {
  const draft = await sender.prepare({
    deviceId: senderDevice,
    ...(groupId ? { groupId } : { recipients: ["bob"] }),
  });
  const conversation = draft.conversations[0];
  if (!conversation) throw new Error("Missing test conversation");
  return { ...draft, conversationId: conversation.id };
}

async function begin(conversationId: string, revision = 0) {
  const operation = await sender.begin({
    deviceId: senderDevice,
    conversationId,
    revision,
  });
  return {
    operation,
    request: {
      operationId: operation.operationId,
      deviceId: senderDevice,
      commits: [{ data: wire, members: operation.members, welcome: wire }],
      welcomes: operation.packages.map((p) => ({
        keyPackageId: p.keyPackageId,
        commitIndex: 0,
      })),
      ciphertext: wire,
    },
  };
}

export {
  db,
  sender,
  receiver,
  outsider,
  senderDevice,
  recipientDevice,
  signatureKey,
  wire,
  prepare,
  begin,
  metrics,
};
