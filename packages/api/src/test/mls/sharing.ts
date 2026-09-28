import { expect, test } from "bun:test";

import { eq } from "@acme/db";
import * as schema from "@acme/db/schema";
import { CONTENT_POLICY_VERSION } from "@acme/validators";

import { validateDraft } from "../../services/mls";
import { db, sender, senderDevice, prepare, begin } from "./fixture";

export function registerSharingTests() {
  test("preparing an encrypted send requires current terms acceptance", async () => {
    await db
      .update(schema.ContentPolicyAcceptance)
      .set({ version: "old" })
      .where(eq(schema.ContentPolicyAcceptance.userId, "alice"));
    await expect(
      sender.prepare({ deviceId: senderDevice, recipients: ["bob"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.select().from(schema.MlsDraft)).toEqual([]);
  });

  test("a suspension or new policy during upload stops delivery", async () => {
    const draft = await prepare();
    const pending = await begin(draft.conversationId);
    await sender.append({ ...pending.request, draftId: draft.draftId });
    expect(
      (await validateDraft(db, "alice", draft.draftId)).recipients,
    ).toEqual(["bob"]);

    await db.insert(schema.AccountSuspension).values({ userId: "alice" });
    await expect(
      validateDraft(db, "alice", draft.draftId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.delete(schema.AccountSuspension);

    await db
      .update(schema.ContentPolicyAcceptance)
      .set({ version: "old" })
      .where(eq(schema.ContentPolicyAcceptance.userId, "alice"));
    await expect(
      validateDraft(db, "alice", draft.draftId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db
      .update(schema.ContentPolicyAcceptance)
      .set({ version: CONTENT_POLICY_VERSION })
      .where(eq(schema.ContentPolicyAcceptance.userId, "alice"));
    expect(
      (await validateDraft(db, "alice", draft.draftId)).recipients,
    ).toEqual(["bob"]);
  });
}
