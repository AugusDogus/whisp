import { expect, test } from "bun:test";

import { eq } from "@acme/db";
import * as schema from "@acme/db/schema";

import { validateDraft } from "../../services/mls";
import {
  db,
  sender,
  receiver,
  senderDevice,
  recipientDevice,
  signatureKey,
  prepare,
  begin,
  metrics,
} from "./fixture";

export function registerApplicationTests() {
  async function applicationFixture(groupId?: string) {
    if (groupId)
      await db.insert(schema.GroupMember).values([
        { groupId, userId: "alice" },
        { groupId, userId: "bob" },
      ]);
    const initial = await prepare(groupId);
    const pending = await begin(initial.conversationId);
    await sender.append({ ...pending.request, draftId: initial.draftId });
    const draft = await prepare(groupId);
    return {
      draft,
      input: {
        deviceId: senderDevice,
        conversationId: draft.conversationId,
        draftId: draft.draftId,
        epoch: 1,
        ciphertext: Buffer.from("application-one").toString("base64"),
      },
    };
  }

  test.each([undefined, "applications-group"])(
    "application publication advances only event revision (group=%s)",
    async (groupId) => {
      const { draft, input } = await applicationFixture(groupId);
      expect(draft.supportsApplicationPublish).toBe(true);
      const operations = await db.select().from(schema.MlsOperation);
      const before = metrics.queryCount;
      expect(await sender.publishApplication(input)).toMatchObject({
        kind: "published",
        revision: 3,
        epoch: 1,
      });
      expect(metrics.queryCount - before).toBeLessThanOrEqual(groupId ? 8 : 7);
      const next = await prepare(groupId);
      expect(
        await sender.publishApplication({
          ...input,
          draftId: next.draftId,
          ciphertext: Buffer.from("application-two").toString("base64"),
        }),
      ).toMatchObject({ kind: "published", revision: 4, epoch: 1 });
      expect(await db.select().from(schema.MlsOperation)).toEqual(operations);
      expect(
        (
          await sender.sync({
            deviceId: senderDevice,
            conversationId: draft.conversationId,
            after: 0,
          })
        ).conversation,
      ).toMatchObject({ revision: 4, epoch: 1 });
      expect(
        (await db.select().from(schema.MlsEvent)).filter(
          (event) => event.entry.kind === "commit",
        ),
      ).toHaveLength(1);
      expect(
        (await validateDraft(db, "alice", next.draftId)).conversationIds,
      ).toEqual([draft.conversationId]);
    },
  );

  test("exact application retry survives later epoch changes and draft cleanup", async () => {
    const { draft, input } = await applicationFixture();
    const published = await sender.publishApplication(input);
    const next = await prepare();
    const refresh = await begin(next.conversationId, 3);
    await sender.append({ ...refresh.request, draftId: next.draftId });
    expect(
      (
        await sender.sync({
          deviceId: senderDevice,
          conversationId: next.conversationId,
          after: 0,
        })
      ).conversation.epoch,
    ).toBe(2);
    await receiver.revoke({ deviceId: recipientDevice });
    expect(await sender.publishApplication(input)).toEqual(published);
    await db
      .delete(schema.MlsDraft)
      .where(eq(schema.MlsDraft.id, draft.draftId));
    expect(await sender.publishApplication(input)).toEqual(published);
    expect(await db.select().from(schema.MlsApplicationAttempt)).toHaveLength(
      1,
    );
    await sender.revoke({ deviceId: senderDevice });
    await expect(sender.publishApplication(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  test("rejected application stays cancelled after roster restoration or draft cleanup", async () => {
    const { draft, input } = await applicationFixture();
    const newDevice = crypto.randomUUID();
    await receiver.register({ deviceId: newDevice, signatureKey });
    expect(await sender.publishApplication(input)).toEqual({
      kind: "cancelled",
    });
    await receiver.revoke({ deviceId: newDevice });
    expect(await sender.publishApplication(input)).toEqual({
      kind: "cancelled",
    });
    const replacement = {
      ...input,
      ciphertext: Buffer.from("next-unused-generation").toString("base64"),
    };
    expect(await sender.publishApplication(replacement)).toMatchObject({
      kind: "published",
      revision: 3,
      epoch: 1,
    });
    await db
      .delete(schema.MlsDraft)
      .where(eq(schema.MlsDraft.id, draft.draftId));
    expect(await sender.publishApplication(input)).toEqual({
      kind: "cancelled",
    });
    expect(await sender.publishApplication(replacement)).toMatchObject({
      kind: "published",
      revision: 3,
    });
  });

  test("missing or expired drafts get durable cancelled application decisions", async () => {
    const { draft, input } = await applicationFixture();
    await db
      .update(schema.MlsDraft)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.MlsDraft.id, draft.draftId));
    expect(await sender.publishApplication(input)).toEqual({
      kind: "cancelled",
    });
    await db
      .delete(schema.MlsDraft)
      .where(eq(schema.MlsDraft.id, draft.draftId));
    const neverReceived = {
      ...input,
      ciphertext: Buffer.from("never-received").toString("base64"),
    };
    expect(await sender.publishApplication(neverReceived)).toEqual({
      kind: "cancelled",
    });
    expect(await sender.publishApplication(neverReceived)).toEqual({
      kind: "cancelled",
    });
    expect(await db.select().from(schema.MlsApplicationAttempt)).toHaveLength(
      2,
    );
  });

  test("application publication authenticates account, draft device and group access", async () => {
    const { input } = await applicationFixture("application-auth-group");
    await expect(receiver.publishApplication(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(
      receiver.publishApplication({ ...input, deviceId: recipientDevice }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const otherDevice = crypto.randomUUID();
    await sender.register({ deviceId: otherDevice, signatureKey });
    await expect(
      sender.publishApplication({ ...input, deviceId: otherDevice }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await sender.revoke({ deviceId: otherDevice });
    expect(await sender.publishApplication(input)).toMatchObject({
      kind: "published",
    });
    await db
      .delete(schema.GroupMember)
      .where(eq(schema.GroupMember.userId, "alice"));
    await expect(sender.publishApplication(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("a new fingerprint cannot replace an already published draft", async () => {
    const { input } = await applicationFixture();
    const accepted = await sender.publishApplication(input);
    const another = {
      ...input,
      ciphertext: Buffer.from("different-ciphertext").toString("base64"),
    };
    expect(await sender.publishApplication(another)).toEqual({
      kind: "cancelled",
    });
    expect(
      await sender.beginSend({
        deviceId: senderDevice,
        conversationId: input.conversationId,
        draftId: input.draftId,
        revision: 3,
      }),
    ).toMatchObject({ kind: "published" });
    expect(await sender.publishApplication(input)).toEqual(accepted);
    expect(
      (await db.select().from(schema.MlsEvent)).filter(
        (event) =>
          event.entry.kind === "application" &&
          event.entry.messageId === input.draftId,
      ),
    ).toHaveLength(1);
  });

  test("stale epoch rejection persists and does not block a new generation", async () => {
    const { input } = await applicationFixture();
    const stale = { ...input, epoch: 0 };
    expect(await sender.publishApplication(stale)).toEqual({
      kind: "cancelled",
    });
    expect(await sender.publishApplication(stale)).toEqual({
      kind: "cancelled",
    });
    await expect(sender.publishApplication(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(
      await sender.publishApplication({
        ...input,
        ciphertext: Buffer.from("correct-epoch-generation").toString("base64"),
      }),
    ).toMatchObject({ kind: "published", epoch: 1 });
  });
}
