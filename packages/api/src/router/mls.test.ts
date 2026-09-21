import { createClient } from "@libsql/client";
import { initTRPC } from "@trpc/server";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "@acme/db";
import * as schema from "@acme/db/schema";

import { validateDraft } from "../services/mls";

const directory = await mkdtemp(join(tmpdir(), "whisp-mls-test-"));
const client = createClient({ url: `file:${join(directory, "test.db")}` });
const db = drizzle({ client, schema });
const t = initTRPC
  .context<{ db: typeof db; session: { user: { id: string } } }>()
  .create();
mock.module("../trpc", () => ({ protectedProcedure: t.procedure }));
const { mlsRouter } = await import("./mls");
const router = t.router(mlsRouter);
const sender = router.createCaller({ db, session: { user: { id: "alice" } } });
const receiver = router.createCaller({ db, session: { user: { id: "bob" } } });
const outsider = router.createCaller({
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
    new URL("../../../db/drizzle/0002_mls.sql", import.meta.url),
  ).text(),
);
await client.executeMultiple(
  await Bun.file(
    new URL("../../../db/drizzle/0003_mls_device_names.sql", import.meta.url),
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

test("new devices store a bounded model name", async () => {
  const deviceId = crypto.randomUUID();
  await sender.register({ deviceId, signatureKey, name: "  Pixel 8 Pro  " });
  expect(
    (await sender.devices()).find((device) => device.id === deviceId),
  ).toMatchObject({ name: "Pixel 8 Pro" });
  for (const name of [" ", "x".repeat(101)]) {
    await expect(
      sender.register({ deviceId, signatureKey, name }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }
});

test("device names update without replacing keys and survive older clients", async () => {
  await sender.register({
    deviceId: senderDevice,
    signatureKey,
    name: "Pixel 8 Pro",
  });
  expect(await sender.devices()).toMatchObject([
    { name: "Pixel 8 Pro", signatureKey },
  ]);
  await sender.register({ deviceId: senderDevice, signatureKey });
  expect(await sender.devices()).toMatchObject([{ name: "Pixel 8 Pro" }]);
  await expect(
    outsider.register({
      deviceId: senderDevice,
      signatureKey,
      name: "Other phone",
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await sender.devices()).toMatchObject([{ name: "Pixel 8 Pro" }]);
  await sender.register({
    deviceId: senderDevice,
    signatureKey,
    name: "Pixel 9",
  });
  expect(await sender.devices()).toMatchObject([
    { name: "Pixel 9", signatureKey },
  ]);
});
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

describe("persistent MLS conversations", () => {
  test("self and peer deliveries resolve their exact conversation in a multi-recipient send", async () => {
    const previous = process.env.ALLOW_SELF_MESSAGES;
    process.env.ALLOW_SELF_MESSAGES = "true";
    try {
      // Bob sorts after Alice, so the peer conversation is stored first.
      const draft = await receiver.prepare({
        deviceId: recipientDevice,
        recipients: ["alice", "bob"],
      });
      const conversations = await db.select().from(schema.MlsConversation);
      for (const recipient of ["alice", "bob"]) {
        const scope = JSON.stringify(
          recipient === "bob"
            ? ["direct", "bob", "bob"]
            : ["direct", "alice", "bob"],
        );
        const expected = conversations.find(
          (conversation) => conversation.scope === scope,
        );
        if (!expected) throw new Error("Missing recipient conversation");
        const deliveryId = crypto.randomUUID();
        await db.insert(schema.MessageDelivery).values({
          id: deliveryId,
          messageId: draft.draftId,
          recipientId: recipient,
        });
        const caller = recipient === "bob" ? receiver : sender;
        const deviceId = recipient === "bob" ? recipientDevice : senderDevice;
        expect(await caller.delivery({ deviceId, deliveryId })).toMatchObject({
          kind: "mls",
          conversationId: expected.id,
        });
      }
    } finally {
      if (previous === undefined) delete process.env.ALLOW_SELF_MESSAGES;
      else process.env.ALLOW_SELF_MESSAGES = previous;
    }
  });
  test("group deliveries resolve the group conversation rather than a direct conversation", async () => {
    await prepare();
    await db.insert(schema.GroupMember).values([
      { groupId: "group", userId: "alice" },
      { groupId: "group", userId: "bob" },
    ]);
    const draft = await prepare("group");
    const deliveryId = crypto.randomUUID();
    await db.insert(schema.MessageDelivery).values({
      id: deliveryId,
      messageId: draft.draftId,
      recipientId: "bob",
      groupId: "group",
    });
    expect(
      await receiver.delivery({ deviceId: recipientDevice, deliveryId }),
    ).toMatchObject({
      kind: "mls",
      conversationId: draft.conversationId,
      groupId: "group",
    });
  });
  test("supports self-delivery only when the existing self-messaging flag is enabled", async () => {
    const previous = process.env.ALLOW_SELF_MESSAGES;
    try {
      process.env.ALLOW_SELF_MESSAGES = "false";
      await expect(
        sender.prepare({ deviceId: senderDevice, recipients: ["alice"] }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message:
          "Sending to yourself is disabled on this server. Your whisp is still queued. Reopen Whisp after self-send is enabled to retry.",
      });
      process.env.ALLOW_SELF_MESSAGES = "true";
      const draft = await sender.prepare({
        deviceId: senderDevice,
        recipients: ["alice"],
      });
      const conversation = draft.conversations[0];
      if (!conversation) throw new Error("Missing self conversation");
      const pending = await begin(conversation.id);
      expect(pending.operation.packages).toHaveLength(0);
      expect(pending.operation.members.map((m) => m.userId)).toEqual(["alice"]);
      await sender.append({ ...pending.request, draftId: draft.draftId });
      expect(
        (await validateDraft(db, "alice", draft.draftId)).recipients,
      ).toEqual(["alice"]);
      expect(
        await sender.retainedMessages({
          deviceId: senderDevice,
          conversationId: conversation.id,
        }),
      ).toContain(draft.draftId);
      const next = await sender.prepare({
        deviceId: senderDevice,
        recipients: ["alice"],
      });
      expect(next.conversations[0]?.id).toBe(conversation.id);
      process.env.ALLOW_SELF_MESSAGES = "false";
      await expect(
        validateDraft(db, "alice", draft.draftId),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      if (previous === undefined) delete process.env.ALLOW_SELF_MESSAGES;
      else process.env.ALLOW_SELF_MESSAGES = previous;
    }
  });
  test("a new device can send without an old device, preserving old deliveries", async () => {
    const original = await prepare();
    const first = await begin(original.conversationId);
    await sender.append({ ...first.request, draftId: original.draftId });
    const deliveryId = crypto.randomUUID();
    await db.insert(schema.MessageDelivery).values({
      id: deliveryId,
      messageId: original.draftId,
      recipientId: "bob",
    });
    const newDevice = crypto.randomUUID();
    await sender.register({ deviceId: newDevice, signatureKey });
    await sender.publish({
      deviceId: senderDevice,
      packages: [{ id: crypto.randomUUID(), data: wire }],
    });
    const input = {
      deviceId: newDevice,
      recipients: ["bob"],
      draftId: crypto.randomUUID(),
    };
    const next = await sender.prepare(input);
    const replacement = next.conversations[0];
    if (!replacement) throw new Error("Missing replacement conversation");
    expect(replacement.id).not.toBe(original.conversationId);
    expect(await sender.prepare(input)).toEqual(next);
    expect(
      await sender.sync({
        deviceId: newDevice,
        conversationId: replacement.id,
        after: 0,
      }),
    ).toMatchObject({ conversation: { revision: 0 } });
    const operation = await sender.begin({
      deviceId: newDevice,
      conversationId: replacement.id,
      revision: 0,
    });
    expect(new Set(operation.members.map((m) => m.deviceId))).toEqual(
      new Set([senderDevice, recipientDevice, newDevice]),
    );
    expect(new Set(operation.packages.map((p) => p.deviceId))).toEqual(
      new Set([senderDevice, recipientDevice]),
    );
    await sender.append({
      operationId: operation.operationId,
      deviceId: newDevice,
      draftId: next.draftId,
      commits: [{ data: wire, members: operation.members, welcome: wire }],
      welcomes: operation.packages.map((p) => ({
        keyPackageId: p.keyPackageId,
        commitIndex: 0,
      })),
      ciphertext: wire,
    });
    const subsequent = await prepare();
    expect(subsequent.conversationId).toBe(replacement.id);
    expect(
      await receiver.delivery({ deviceId: recipientDevice, deliveryId }),
    ).toMatchObject({ conversationId: original.conversationId });
    expect(
      await sender.prepare({
        deviceId: senderDevice,
        recipients: ["bob"],
        draftId: original.draftId,
      }),
    ).toMatchObject({ conversations: [{ id: original.conversationId }] });
    expect(
      await sender.sync({
        deviceId: senderDevice,
        conversationId: replacement.id,
        after: 0,
      }),
    ).toMatchObject({ welcome: { deviceId: senderDevice } });
    await expect(
      sender.sync({
        deviceId: newDevice,
        conversationId: original.conversationId,
        after: 0,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  for (const kind of ["self", "group"] as const) {
    test(`a paused ${kind} send recovers on a new device and reuses the replacement`, async () => {
      const previous = process.env.ALLOW_SELF_MESSAGES;
      process.env.ALLOW_SELF_MESSAGES = "true";
      try {
        if (kind === "group")
          await db.insert(schema.GroupMember).values([
            { groupId: "group", userId: "alice" },
            { groupId: "group", userId: "bob" },
          ]);
        const target =
          kind === "self" ? { recipients: ["alice"] } : { groupId: "group" };
        const initial = await sender.prepare({
          deviceId: senderDevice,
          ...target,
        });
        const original = initial.conversations[0];
        if (!original) throw new Error("Missing initial conversation");
        const first = await begin(original.id);
        await sender.append({ ...first.request, draftId: initial.draftId });
        const deviceId = crypto.randomUUID();
        await sender.register({ deviceId, signatureKey });
        await sender.publish({
          deviceId: senderDevice,
          packages: [{ id: crypto.randomUUID(), data: wire }],
        });
        // Reproduce a durable job already prepared by the old server.
        const draftId = crypto.randomUUID();
        await db.insert(schema.MlsDraft).values({
          id: draftId,
          senderId: "alice",
          senderDeviceId: deviceId,
          recipients: kind === "self" ? ["alice"] : ["bob"],
          groupId: kind === "group" ? "group" : null,
          conversationIds: [original.id],
          expiresAt: new Date(Date.now() + 60_000),
        });
        const recovered = await sender.prepare({
          deviceId,
          draftId,
          ...target,
        });
        const next = recovered.conversations[0];
        if (!next) throw new Error("Missing recovered conversation");
        expect(next.id).not.toBe(original.id);
        expect(await sender.prepare({ deviceId, draftId, ...target })).toEqual(
          recovered,
        );
        const operation = await sender.begin({
          deviceId,
          conversationId: next.id,
          revision: 0,
        });
        await sender.append({
          operationId: operation.operationId,
          deviceId,
          draftId,
          commits: [{ data: wire, members: operation.members, welcome: wire }],
          welcomes: operation.packages.map((p) => ({
            keyPackageId: p.keyPackageId,
            commitIndex: 0,
          })),
          ciphertext: wire,
        });
        expect(
          (await validateDraft(db, "alice", draftId)).conversationIds,
        ).toEqual([next.id]);
        expect(
          (await sender.prepare({ deviceId, ...target })).conversations,
        ).toEqual([{ id: next.id }]);
        const deliveryId = crypto.randomUUID();
        await db.insert(schema.MessageDelivery).values({
          id: deliveryId,
          messageId: initial.draftId,
          recipientId: kind === "self" ? "alice" : "bob",
          groupId: kind === "group" ? "group" : null,
        });
        const recipient = kind === "self" ? sender : receiver;
        expect(
          await recipient.delivery({
            deviceId: kind === "self" ? senderDevice : recipientDevice,
            deliveryId,
          }),
        ).toMatchObject({ conversationId: original.id });
        await expect(
          outsider.prepare({ deviceId, ...target }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      } finally {
        if (previous === undefined) delete process.env.ALLOW_SELF_MESSAGES;
        else process.env.ALLOW_SELF_MESSAGES = previous;
      }
    });
  }
  test("binds immutable device identities to authenticated accounts", async () => {
    await expect(
      outsider.register({ deviceId: senderDevice, signatureKey }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      sender.register({
        deviceId: senderDevice,
        signatureKey: Buffer.alloc(32, 2).toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await outsider.revoke({ deviceId: senderDevice });
    expect(await sender.devices()).toHaveLength(1);
    await sender.revoke({ deviceId: senderDevice });
    await expect(
      sender.register({ deviceId: senderDevice, signatureKey }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  test("reuses a direct conversation for both participants across whisps", async () => {
    const first = await prepare();
    const operation = await begin(first.conversationId);
    await sender.append({ ...operation.request, draftId: first.draftId });
    const second = await prepare();
    const reply = await receiver.prepare({
      deviceId: recipientDevice,
      recipients: ["alice"],
    });
    expect(second.conversationId).toBe(first.conversationId);
    expect(reply.conversations[0]?.id).toBe(first.conversationId);
    const next = await begin(second.conversationId, 2);
    expect(next.operation.packages).toHaveLength(0);
    await sender.append({ ...next.request, draftId: second.draftId });
    const synced = await receiver.sync({
      deviceId: recipientDevice,
      conversationId: first.conversationId,
      after: 0,
    });
    expect(synced.conversation.revision).toBe(4);
    expect(synced.welcome?.sequence).toBe(1);
    expect(synced.events.map((e) => e.sequence)).toEqual([2, 3, 4]);
  });
  test("accepts one concurrent commit and settles late requests without rollback ambiguity", async () => {
    const draft = await prepare();
    const first = await begin(draft.conversationId);
    const second = await begin(draft.conversationId);
    expect(first.operation.packages[0]?.keyPackageId).not.toBe(
      second.operation.packages[0]?.keyPackageId,
    );
    expect(
      await sender.append({ ...first.request, draftId: draft.draftId }),
    ).toEqual({ revision: 2 });
    await expect(
      sender.append({ ...second.request, draftId: draft.draftId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await sender.settle({
        deviceId: senderDevice,
        operationId: first.operation.operationId,
      }),
    ).toEqual({ revision: 2 });
    expect(
      await sender.settle({
        deviceId: senderDevice,
        operationId: second.operation.operationId,
      }),
    ).toEqual({ revision: null });
    await expect(
      sender.append({ ...second.request, draftId: draft.draftId }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(
      await sender.append({ ...first.request, draftId: draft.draftId }),
    ).toEqual({ revision: 2 });
    expect(await db.select().from(schema.MlsEvent)).toHaveLength(2);
  });
  test("requires a Welcome for each newly added device, rejects unauthorized log access", async () => {
    const draft = await prepare();
    const pending = await begin(draft.conversationId);
    await expect(
      sender.append({
        ...pending.request,
        draftId: draft.draftId,
        welcomes: [],
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await db.select().from(schema.MlsEvent)).toHaveLength(0);
    await sender.append({ ...pending.request, draftId: draft.draftId });
    await expect(
      outsider.sync({
        deviceId: recipientDevice,
        conversationId: draft.conversationId,
        after: 0,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      outsider.prepare({ deviceId: senderDevice, recipients: ["bob"] }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const newcomer = crypto.randomUUID();
    await receiver.register({ deviceId: newcomer, signatureKey });
    await expect(
      receiver.sync({
        deviceId: newcomer,
        conversationId: draft.conversationId,
        after: 0,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  test("validates the encryption-time roster again before uploading", async () => {
    await db.insert(schema.GroupMember).values([
      { groupId: "group", userId: "alice" },
      { groupId: "group", userId: "bob" },
    ]);
    const draft = await prepare("group");
    const pending = await begin(draft.conversationId);
    await expect(
      validateDraft(db, "alice", draft.draftId),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await sender.append({ ...pending.request, draftId: draft.draftId });
    expect(
      (await validateDraft(db, "alice", draft.draftId)).recipients,
    ).toEqual(["bob"]);
    await db
      .insert(schema.GroupMember)
      .values({ groupId: "group", userId: "mallory" });
    await expect(
      validateDraft(db, "alice", draft.draftId),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await db
      .delete(schema.GroupMember)
      .where(eq(schema.GroupMember.userId, "mallory"));
    await receiver.revoke({ deviceId: recipientDevice });
    await expect(
      validateDraft(db, "alice", draft.draftId),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  test("retires a private KeyPackage only after its Welcome is durably acknowledged", async () => {
    const draft = await prepare();
    const pending = await begin(draft.conversationId);
    await sender.append({ ...pending.request, draftId: draft.draftId });
    const key = pending.operation.packages[0];
    if (!key) throw new Error("Missing fixture key");
    expect(
      await receiver.retainedKeys({ deviceId: recipientDevice }),
    ).toContain(key.keyPackageId);
    await receiver.acknowledgeWelcome({
      deviceId: recipientDevice,
      keyPackageId: key.keyPackageId,
    });
    expect(
      await receiver.retainedKeys({ deviceId: recipientDevice }),
    ).not.toContain(key.keyPackageId);
  });
  test("rejects already-read deliveries on every device belonging to the recipient", async () => {
    const draft = await prepare();
    const pending = await begin(draft.conversationId);
    await sender.append({ ...pending.request, draftId: draft.draftId });
    const otherDevice = crypto.randomUUID();
    await receiver.register({ deviceId: otherDevice, signatureKey });
    const deliveryId = crypto.randomUUID();
    await db.insert(schema.MessageDelivery).values({
      id: deliveryId,
      messageId: draft.draftId,
      recipientId: "bob",
    });
    expect(
      await receiver.delivery({ deviceId: recipientDevice, deliveryId }),
    ).toMatchObject({ kind: "mls", conversationId: draft.conversationId });
    await expect(
      sender.delivery({ deviceId: senderDevice, deliveryId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db
      .update(schema.MessageDelivery)
      .set({ readAt: new Date() })
      .where(eq(schema.MessageDelivery.id, deliveryId));
    for (const deviceId of [recipientDevice, otherDevice]) {
      await expect(
        receiver.delivery({ deviceId, deliveryId }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(
        await receiver.retainedMessages({
          deviceId,
          conversationId: draft.conversationId,
        }),
      ).not.toContain(draft.draftId);
    }
  });
});

test("native retries reuse a draft and cannot reuse another device's send ID", async () => {
  const draftId = crypto.randomUUID();
  const input = { deviceId: senderDevice, recipients: ["bob"], draftId };
  const first = await sender.prepare(input);
  expect(await sender.prepare(input)).toEqual(first);
  expect(await db.select().from(schema.MlsDraft)).toHaveLength(1);
  await expect(
    receiver.prepare({
      deviceId: recipientDevice,
      recipients: ["alice"],
      draftId,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});

test("native recovery detects a published descriptor without appending twice", async () => {
  const draft = await prepare();
  const input = {
    deviceId: senderDevice,
    draftId: draft.draftId,
    conversationId: draft.conversationId,
  };
  expect(await sender.descriptorPublished(input)).toBe(false);
  const { request } = await begin(draft.conversationId);
  await sender.append({ ...request, draftId: draft.draftId });
  expect(await sender.descriptorPublished(input)).toBe(true);
  expect(
    await receiver.descriptorPublished({ ...input, deviceId: recipientDevice }),
  ).toBe(false);
});
