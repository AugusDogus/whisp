import { createClient } from "@libsql/client";
import { afterAll, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@acme/db/schema";

import {
  getLastReceivedMessages,
  getLastSentMessages,
  getPendingSentDeliveries,
} from "./message-status";

const client = createClient({ url: ":memory:" });
let queries = 0;
const database = drizzle({
  client,
  schema,
  logger: { logQuery: () => queries++ },
});
await client.executeMultiple(`
  CREATE TABLE message (id TEXT PRIMARY KEY, senderId TEXT, mimeType TEXT);
  CREATE TABLE message_delivery (id TEXT PRIMARY KEY, messageId TEXT, recipientId TEXT, groupId TEXT, createdAt INTEGER, readAt INTEGER);
  INSERT INTO message VALUES
    ('old-photo', 'me', 'image/jpeg'),
    ('sent-encrypted', 'me', 'application/vnd.whisp.mls.v1'),
    ('received-encrypted', 'friend', 'application/vnd.whisp.mls.v1'),
    ('group-video', 'me', 'video/mp4'),
    ('other-recipient', 'me', 'image/jpeg');
  INSERT INTO message_delivery VALUES
    ('a', 'old-photo', 'friend', NULL, 1, NULL),
    ('b', 'sent-encrypted', 'friend', NULL, 2, NULL),
    ('c', 'received-encrypted', 'me', NULL, 3, NULL),
    ('d', 'group-video', 'friend', 'group', 4, NULL),
    ('e', 'other-recipient', 'other', NULL, 5, NULL);
`);
afterAll(() => client.close());

test("sent status identifies the exact latest direct message without leaking another recipient or group", async () => {
  expect(await getLastSentMessages(database, "me", ["friend"])).toEqual(
    new Map([
      [
        "friend",
        {
          messageId: "sent-encrypted",
          mimeType: "application/vnd.whisp.mls.v1",
        },
      ],
    ]),
  );
});

test("received status identifies the latest direct message from the requested friend", async () => {
  expect(await getLastReceivedMessages(database, "me", ["friend"])).toEqual(
    new Map([
      [
        "friend",
        {
          messageId: "received-encrypted",
          mimeType: "application/vnd.whisp.mls.v1",
        },
      ],
    ]),
  );
});

test("pending sent status uses one query and excludes read, group, and other-sender deliveries", async () => {
  await client.executeMultiple(`
    INSERT INTO message VALUES ('read', 'me', 'image/jpeg'), ('foreign', 'stranger', 'image/jpeg');
    INSERT INTO message_delivery VALUES
      ('read-delivery', 'read', 'read-only', NULL, 6, 7),
      ('foreign-delivery', 'foreign', 'foreign-only', NULL, 6, NULL),
      ('group-only', 'group-video', 'group-only', 'group', 6, NULL),
      ('orphan', 'missing', 'orphan-only', NULL, 6, NULL);
  `);
  queries = 0;
  expect(
    await getPendingSentDeliveries(database, "me", [
      "friend",
      "read-only",
      "foreign-only",
      "group-only",
      "orphan-only",
    ]),
  ).toEqual(new Set(["friend"]));
  expect(queries).toBe(1);
  queries = 0;
  expect(await getPendingSentDeliveries(database, "me", [])).toEqual(new Set());
  expect(queries).toBe(0);
});
