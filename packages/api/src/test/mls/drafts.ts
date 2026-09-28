import { expect, test } from "bun:test";

import { eq } from "@acme/db";
import * as schema from "@acme/db/schema";

import { validateDraft } from "../../services/mls";
import {
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
} from "./fixture";

export function registerDraftTests() {
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

  test("retrying a published draft never changes its session after membership changes", async () => {
    const draft = await prepare();
    const pending = await begin(draft.conversationId);
    await sender.append({ ...pending.request, draftId: draft.draftId });
    await db
      .update(schema.MlsConversation)
      .set({
        members: pending.operation.members.filter(
          (m) => m.deviceId !== senderDevice,
        ),
      })
      .where(eq(schema.MlsConversation.id, draft.conversationId));
    const retry = await sender.prepare({
      deviceId: senderDevice,
      draftId: draft.draftId,
      recipients: ["bob"],
    });
    expect(retry.conversations).toEqual([{ id: draft.conversationId }]);
    expect(await db.select().from(schema.MlsConversation)).toHaveLength(1);
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
      await receiver.descriptorPublished({
        ...input,
        deviceId: recipientDevice,
      }),
    ).toBe(false);
  });

  test("delivery authorization rejects removed group members before cached metadata can be used", async () => {
    await db.insert(schema.GroupMember).values([
      { groupId: "group", userId: "alice" },
      { groupId: "group", userId: "bob" },
    ]);
    const draft = await prepare("group");
    const pending = await begin(draft.conversationId);
    await sender.append({ ...pending.request, draftId: draft.draftId });
    const deliveryId = crypto.randomUUID();
    await db.insert(schema.MessageDelivery).values({
      id: deliveryId,
      messageId: draft.draftId,
      recipientId: "bob",
      groupId: "group",
    });
    expect(
      await receiver.delivery({ deviceId: recipientDevice, deliveryId }),
    ).toMatchObject({ kind: "mls", messageId: draft.draftId });
    await db
      .delete(schema.GroupMember)
      .where(eq(schema.GroupMember.userId, "bob"));
    await expect(
      receiver.delivery({ deviceId: recipientDevice, deliveryId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (
        await db
          .select()
          .from(schema.MessageDelivery)
          .where(eq(schema.MessageDelivery.id, deliveryId))
      )[0]?.readAt,
    ).toBeNull();
  });

  test("conversation sync includes current retention even when no new events exist", async () => {
    const draft = await prepare();
    const pending = await begin(draft.conversationId);
    await sender.append({ ...pending.request, draftId: draft.draftId });
    const deliveryId = crypto.randomUUID();
    await db
      .insert(schema.MessageDelivery)
      .values({ id: deliveryId, messageId: draft.draftId, recipientId: "bob" });
    const input = {
      deviceId: recipientDevice,
      conversationId: draft.conversationId,
      after: 2,
    };
    const unread = await receiver.sync(input);
    expect(unread.events).toEqual([]);
    expect(unread.retainedMessageIds).toEqual([draft.draftId]);
    await db
      .update(schema.MessageDelivery)
      .set({ readAt: new Date() })
      .where(eq(schema.MessageDelivery.id, deliveryId));
    const read = await receiver.sync(input);
    expect(read.events).toEqual([]);
    expect(read.retainedMessageIds).toEqual([]);
  });

  test("prepare registers a new sender identity atomically and preserves existing names", async () => {
    const deviceId = crypto.randomUUID();
    const input = { deviceId, signatureKey, recipients: ["bob"] };
    const prepared = await sender.prepare(input);
    expect(prepared.deviceIdentityValidated).toBe(true);
    expect(
      (await sender.devices()).some((device) => device.id === deviceId),
    ).toBe(true);
    await sender.register({ deviceId, signatureKey, name: "Test phone" });
    await sender.prepare({ ...input, draftId: prepared.draftId });
    expect(
      (await sender.devices()).find((device) => device.id === deviceId)?.name,
    ).toBe("Test phone");
    const rejectedId = crypto.randomUUID();
    await expect(
      sender.prepare({
        ...input,
        deviceId: rejectedId,
        recipients: ["mallory"],
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(
      (await sender.devices()).some((device) => device.id === rejectedId),
    ).toBe(false);
  });

  test("prepare registration rejects replaced, foreign, revoked and excess identities", async () => {
    const input = { deviceId: senderDevice, signatureKey, recipients: ["bob"] };
    await expect(
      sender.prepare({
        ...input,
        signatureKey: Buffer.alloc(32, 2).toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      sender.prepare({ ...input, deviceId: recipientDevice }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await sender.revoke({ deviceId: senderDevice });
    await expect(sender.prepare(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    for (let index = 0; index < 10; index++)
      await sender.register({ deviceId: crypto.randomUUID(), signatureKey });
    await expect(
      sender.prepare({ ...input, deviceId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await db.select().from(schema.MlsDraft)).toHaveLength(0);
  });

  test("sync includes the requesting sender device's publication receipt", async () => {
    const draft = await prepare();
    const input = {
      deviceId: senderDevice,
      conversationId: draft.conversationId,
      draftId: draft.draftId,
      after: 0,
    };
    expect((await sender.sync(input)).descriptorPublished).toBe(false);
    const { request } = await begin(draft.conversationId);
    await sender.append({ ...request, draftId: draft.draftId });
    expect((await sender.sync(input)).descriptorPublished).toBe(true);
    expect(
      (await receiver.sync({ ...input, deviceId: recipientDevice }))
        .descriptorPublished,
    ).toBe(false);
    await expect(outsider.sync(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await sender.revoke({ deviceId: senderDevice });
    await expect(sender.sync(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  test("upload validation checks every sealed conversation against its own active roster", async () => {
    await db
      .insert(schema.Friendship)
      .values({ userIdA: "alice", userIdB: "mallory" });
    const otherDevice = crypto.randomUUID();
    await outsider.register({ deviceId: otherDevice, signatureKey });
    await outsider.publish({
      deviceId: otherDevice,
      packages: [{ id: crypto.randomUUID(), data: wire }],
    });
    const draft = await sender.prepare({
      deviceId: senderDevice,
      recipients: ["bob", "mallory"],
    });
    const [first, second] = draft.conversations;
    if (!first || !second)
      throw new Error("Missing multi-recipient fixture conversations");
    const firstPending = await begin(first.id);
    await sender.append({ ...firstPending.request, draftId: draft.draftId });
    await expect(validateDraft(db, "alice", draft.draftId)).rejects.toThrow(
      "not encrypted for every conversation",
    );
    const secondPending = await begin(second.id);
    await sender.append({ ...secondPending.request, draftId: draft.draftId });
    const beforeValidation = metrics.queryCount;
    expect(
      (await validateDraft(db, "alice", draft.draftId)).recipients,
    ).toEqual(["bob", "mallory"]);
    // Recipient fanout must not add a separate sequence of DB round trips.
    expect(metrics.queryCount - beforeValidation).toBeLessThanOrEqual(4);
    await expect(
      validateDraft(db, "mallory", draft.draftId),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await outsider.register({ deviceId: crypto.randomUUID(), signatureKey });
    await expect(validateDraft(db, "alice", draft.draftId)).rejects.toThrow(
      "Recipient devices changed",
    );
    await sender.revoke({ deviceId: senderDevice });
    await expect(validateDraft(db, "alice", draft.draftId)).rejects.toThrow(
      "encryption device is unavailable",
    );
  });

  test("atomic begin returns an existing publication before checking stale revision", async () => {
    const draft = await prepare();
    expect(draft.supportsAtomicBegin).toBe(true);
    const input = {
      deviceId: senderDevice,
      conversationId: draft.conversationId,
      draftId: draft.draftId,
      revision: 0,
    };
    const begun = await sender.beginSend(input);
    if (begun.kind !== "operation") throw new Error("Expected new operation");
    expect(begun.retainedMessageIds).toEqual([]);
    await sender.append({
      deviceId: senderDevice,
      draftId: draft.draftId,
      operationId: begun.operation.operationId,
      commits: [
        { data: wire, members: begun.operation.members, welcome: wire },
      ],
      welcomes: begun.operation.packages.map((p) => ({
        keyPackageId: p.keyPackageId,
        commitIndex: 0,
      })),
      ciphertext: wire,
    });
    const before = await db.select().from(schema.MlsOperation);
    expect(await sender.beginSend(input)).toEqual({
      kind: "published",
      retainedMessageIds: [],
    });
    expect(await db.select().from(schema.MlsOperation)).toEqual(before);
    await sender.revoke({ deviceId: senderDevice });
    await expect(sender.beginSend(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  test("atomic begin rejects stale revisions without reserving operations or keys", async () => {
    const draft = await prepare();
    const first = await begin(draft.conversationId);
    await sender.append({ ...first.request, draftId: draft.draftId });
    const next = await prepare();
    const input = {
      deviceId: senderDevice,
      conversationId: next.conversationId,
      draftId: next.draftId,
      revision: 0,
    };
    const before = await db.select().from(schema.MlsOperation);
    const keys = await db.select().from(schema.MlsKeyPackage);
    await expect(sender.beginSend(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await db.select().from(schema.MlsOperation)).toEqual(before);
    expect(await db.select().from(schema.MlsKeyPackage)).toEqual(keys);
    const synced = await sender.sync({
      deviceId: senderDevice,
      conversationId: next.conversationId,
      after: 0,
    });
    expect(
      (
        await sender.beginSend({
          ...input,
          revision: synced.conversation.revision,
        })
      ).kind,
    ).toBe("operation");
  });

  test("atomic begin authenticates draft ownership, device and current group access", async () => {
    await db.insert(schema.GroupMember).values([
      { groupId: "atomic-group", userId: "alice" },
      { groupId: "atomic-group", userId: "bob" },
    ]);
    const draft = await prepare("atomic-group");
    const input = {
      deviceId: senderDevice,
      conversationId: draft.conversationId,
      draftId: draft.draftId,
      revision: 0,
    };
    await expect(
      receiver.beginSend({ ...input, deviceId: recipientDevice }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const otherDevice = crypto.randomUUID();
    await sender.register({ deviceId: otherDevice, signatureKey });
    await expect(
      sender.beginSend({ ...input, deviceId: otherDevice }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      sender.beginSend({ ...input, draftId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await db
      .delete(schema.GroupMember)
      .where(eq(schema.GroupMember.userId, "alice"));
    await expect(sender.beginSend(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await db.select().from(schema.MlsOperation)).toEqual([]);
  });

  test("append batches commit and Welcome writes without extra per-commit queries", async () => {
    const secondRecipientDevice = crypto.randomUUID();
    await receiver.register({ deviceId: secondRecipientDevice, signatureKey });
    await receiver.publish({
      deviceId: secondRecipientDevice,
      packages: [{ id: crypto.randomUUID(), data: wire }],
    });
    const draft = await prepare();
    const pending = await begin(draft.conversationId);
    const input = {
      ...pending.request,
      draftId: draft.draftId,
      commits: [
        ...pending.request.commits,
        { data: wire, members: pending.operation.members },
      ],
    };
    const beforeAppend = metrics.queryCount;
    const accepted = await sender.append(input);
    expect(metrics.queryCount - beforeAppend).toBeLessThanOrEqual(8);
    expect(accepted.revision).toBe(3);
    expect(
      new Set(
        (await db.select().from(schema.MlsWelcome)).map(
          (welcome) => welcome.deviceId,
        ),
      ),
    ).toEqual(new Set([recipientDevice, secondRecipientDevice]));
    const synced = await receiver.sync({
      deviceId: recipientDevice,
      conversationId: draft.conversationId,
      after: 0,
    });
    expect(synced.welcome?.sequence).toBe(1);
    expect(
      synced.events.map((event) => ({
        sequence: event.sequence,
        kind: event.entry.kind,
      })),
    ).toEqual([
      { sequence: 2, kind: "commit" },
      { sequence: 3, kind: "application" },
    ]);
    const beforeRetry = metrics.queryCount;
    // Accepted operations remain idempotent even if an obsolete draft ID is sent.
    expect(
      await sender.append({ ...input, draftId: crypto.randomUUID() }),
    ).toEqual(accepted);
    expect(metrics.queryCount - beforeRetry).toBe(1);
    await sender.revoke({ deviceId: senderDevice });
    await expect(sender.append(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  test("append validates every Welcome before advancing the conversation", async () => {
    const draft = await prepare();
    const pending = await begin(draft.conversationId);
    await expect(
      sender.append({
        ...pending.request,
        draftId: draft.draftId,
        welcomes: pending.request.welcomes.map((welcome) => ({
          ...welcome,
          commitIndex: 1,
        })),
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await db.select().from(schema.MlsEvent)).toEqual([]);
    expect(await db.select().from(schema.MlsWelcome)).toEqual([]);
    expect(await db.select().from(schema.MlsDraftConversation)).toEqual([]);
    expect(
      (
        await sender.sync({
          deviceId: senderDevice,
          conversationId: draft.conversationId,
          after: 0,
        })
      ).conversation.revision,
    ).toBe(0);
    await expect(
      sender.append({ ...pending.request, draftId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      receiver.append({
        ...pending.request,
        deviceId: recipientDevice,
        draftId: draft.draftId,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(
      await sender.append({ ...pending.request, draftId: draft.draftId }),
    ).toEqual({ revision: 2 });
  });

  test("joined append authorization rejects membership changes before writing events", async () => {
    await db.insert(schema.GroupMember).values([
      { groupId: "append-group", userId: "alice" },
      { groupId: "append-group", userId: "bob" },
    ]);
    const draft = await prepare("append-group");
    const pending = await begin(draft.conversationId);
    await db
      .delete(schema.GroupMember)
      .where(eq(schema.GroupMember.userId, "alice"));
    await expect(
      sender.append({ ...pending.request, draftId: draft.draftId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.select().from(schema.MlsEvent)).toEqual([]);
    await db
      .insert(schema.GroupMember)
      .values({ groupId: "append-group", userId: "alice" });
    await receiver.revoke({ deviceId: recipientDevice });
    await expect(
      sender.append({ ...pending.request, draftId: draft.draftId }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await db.select().from(schema.MlsEvent)).toEqual([]);
  });
}
