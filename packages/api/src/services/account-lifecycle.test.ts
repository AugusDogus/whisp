import { expect, test } from "bun:test";

import { eq } from "@acme/db";
import { Enforcement } from "@acme/db/enforcement";
import * as schema from "@acme/db/schema";

import { PreviewScope } from "../uploadthing/preview-scope";
import { AccountDeletion } from "./account-deletion";
import { Blocking } from "./blocking";
import { ContentAccess } from "./content-access";
import { MessageRecipients } from "./message-recipients";
import { Moderation } from "./moderation";
import { SafetyCleanup } from "./safety-cleanup";
import { createSafetyTestDatabase } from "./safety-test-fixture";

const database = await createSafetyTestDatabase();

test("ordinary deletion erases linked data and queues media, without retaining identity", async () => {
  await database.insert(schema.account).values({
    id: "oauth",
    userId: "alice",
    accountId: "123456789012345678",
    providerId: "discord",
    accessToken: "secret",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await database
    .insert(schema.PushToken)
    .values({ userId: "alice", token: "device", platform: "android" });
  await database.insert(schema.AbuseReport).values({
    reporterId: "bob",
    reportedUserId: "alice",
    reason: "spam",
    details: "Unreviewed allegation",
  });
  await database
    .insert(schema.UserBlock)
    .values({ blockerId: "bob", blockedId: "alice" });
  await database
    .insert(schema.FriendRequest)
    .values({ fromUserId: "alice", toUserId: "carol", status: "pending" });
  await database
    .insert(schema.Group)
    .values({ id: "owned", name: "Alice's group", createdById: "alice" });
  await database
    .insert(schema.GroupMember)
    .values({ userId: "bob", groupId: "owned" });
  await database.insert(schema.Message).values([
    {
      id: "sent",
      senderId: "alice",
      fileKey: "sent-file",
      fileUrl: "https://test.ufs.sh/f/sent-file",
    },
    {
      id: "group",
      senderId: "bob",
      groupId: "owned",
      fileKey: "group-file",
      fileUrl: "https://test.ufs.sh/f/group-file",
    },
    {
      id: "received",
      senderId: "bob",
      fileKey: "other-file",
      fileUrl: "https://test.ufs.sh/f/other-file",
    },
  ]);
  await database.insert(schema.MessageDelivery).values([
    { messageId: "sent", recipientId: "bob" },
    { messageId: "group", recipientId: "carol", groupId: "owned" },
    { messageId: "received", recipientId: "alice" },
  ]);
  await database.insert(schema.BackgroundUploadTestFile).values({
    userId: "alice",
    fileKey: "test-file",
    fileUrl: "https://test.ufs.sh/f/test-file",
    originalFileName: "private.jpg",
  });
  await AccountDeletion.remove(database, "alice", undefined);
  for (const table of [
    schema.account,
    schema.PushToken,
    schema.AbuseReport,
    schema.UserBlock,
    schema.FriendRequest,
    schema.Friendship,
    schema.Group,
    schema.GroupMember,
    schema.MessageDelivery,
    schema.BackgroundUploadTestFile,
    schema.AbuseEnforcement,
  ]) {
    expect(await database.select().from(table)).toHaveLength(0);
  }
  expect(
    (await database.select().from(schema.Message)).map((m) => m.id),
  ).toEqual(["received"]);
  expect(
    new Set(
      (await database.select().from(schema.FileDeletion)).map(
        (file) => file.fileKey,
      ),
    ),
  ).toEqual(new Set(["sent-file", "group-file", "test-file"]));
  expect(await ContentAccess.status(database, "alice")).toEqual({
    status: "unavailable",
  });
  expect(
    await MessageRecipients.resolve(database, "alice", { recipients: ["bob"] }),
  ).toEqual({ status: "restricted" });
  await expect(
    database
      .insert(schema.PushToken)
      .values({ userId: "alice", token: "late", platform: "android" })
      .execute(),
  ).rejects.toThrow();
  await AccountDeletion.remove(database, "alice", undefined);
  expect(await database.select().from(schema.FileDeletion)).toHaveLength(3);
});

const enforcementConfig = {
  key: "test-only-enforcement-secret-at-least-32-characters",
  policyVersion: "test-policy",
};
const seriousDecision = () => ({
  action: "enforce",
  reason: "credible_threat",
  expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  confirmedSeriousAbuse: true,
  necessaryDespiteDeletion: true,
  shorterPeriodInsufficient: true,
  rightsAndAgeConsidered: true,
});
async function reportedAccount() {
  await database.insert(schema.account).values({
    id: "discord",
    userId: "bob",
    accountId: "123456789012345678",
    providerId: "discord",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await database.insert(schema.AbuseReport).values({
    id: "serious",
    reporterId: "alice",
    reportedUserId: "bob",
    reason: "violence",
    details: "Allegation, not a finding",
  });
}

test("retention needs approved configuration and every human attestation", async () => {
  await reportedAccount();
  expect(
    await Moderation.resolve(database, "serious", seriousDecision()),
  ).toEqual({ status: "retention_not_configured" });
  expect(
    await Moderation.resolve(
      database,
      "serious",
      { ...seriousDecision(), confirmedSeriousAbuse: false },
      enforcementConfig,
    ),
  ).toEqual({ status: "invalid_decision" });
  expect(
    await Moderation.resolve(
      database,
      "serious",
      { ...seriousDecision(), expiresAt: new Date(0).toISOString() },
      enforcementConfig,
    ),
  ).toEqual({ status: "invalid_decision" });
  expect(await database.select().from(schema.AbuseEnforcement)).toHaveLength(0);
  expect(await database.select().from(schema.AccountSuspension)).toHaveLength(
    0,
  );
  expect((await database.select().from(schema.AbuseReport))[0]?.status).toBe(
    "pending",
  );
});

test("expiry stops enforcement immediately and cleanup physically removes the decision", async () => {
  await reportedAccount();
  expect(
    (
      await Moderation.resolve(
        database,
        "serious",
        seriousDecision(),
        enforcementConfig,
      )
    ).status,
  ).toBe("resolved");
  const [decision] = await database.select().from(schema.AbuseEnforcement);
  if (!decision) throw new Error("Expected enforcement");
  expect(
    await Enforcement.apply(
      database,
      { ...enforcementConfig, key: undefined },
      "bob",
    ),
  ).toEqual({ status: "unconfigured" });
  expect(
    await Enforcement.apply(
      database,
      {
        ...enforcementConfig,
        key: "wrong-test-key-with-at-least-32-characters",
      },
      "bob",
    ),
  ).toEqual({ status: "key_mismatch" });
  // Model elapsed time without waiting for the daily purge.
  await database
    .update(schema.AbuseEnforcement)
    .set({ expiresAt: new Date(0) });
  await database
    .update(schema.AccountSuspension)
    .set({ expiresAt: new Date(0) });
  expect(await ContentAccess.status(database, "bob")).toEqual({
    status: "allowed",
  });
  expect(await Blocking.canContact(database, "alice", "bob")).toBe(true);
  expect(
    await Enforcement.apply(
      database,
      { key: undefined, policyVersion: undefined },
      "bob",
    ),
  ).toEqual({ status: "ready" });
  await SafetyCleanup.run(database, undefined, async () => ({ success: true }));
  expect(await database.select().from(schema.AbuseEnforcement)).toHaveLength(0);
  expect(await database.select().from(schema.AccountSuspension)).toHaveLength(
    0,
  );
});

test("revocation by decision ID restores all linked accounts after original deletion", async () => {
  await reportedAccount();
  await Moderation.resolve(
    database,
    "serious",
    seriousDecision(),
    enforcementConfig,
  );
  const [decision] = await database.select().from(schema.AbuseEnforcement);
  if (!decision) throw new Error("Expected enforcement");
  await AccountDeletion.remove(database, "bob", undefined);
  await database.insert(schema.account).values({
    id: "rejoined",
    userId: "carol",
    accountId: "123456789012345678",
    providerId: "discord",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await Enforcement.apply(database, enforcementConfig, "carol");
  expect(await ContentAccess.status(database, "carol")).toEqual({
    status: "suspended",
  });
  await database
    .delete(schema.AbuseEnforcement)
    .where(eq(schema.AbuseEnforcement.id, decision.id));
  expect(await ContentAccess.status(database, "carol")).toEqual({
    status: "allowed",
  });
  expect(await database.select().from(schema.AccountSuspension)).toHaveLength(
    0,
  );
});

test("failed cloud deletion retries without identity and previews cannot delete inherited files", async () => {
  const scope = PreviewScope.parse("23");
  await database
    .insert(schema.FileDeletion)
    .values([{ fileKey: "owned" }, { fileKey: "inherited" }]);
  await database.insert(schema.PreviewUpload).values({
    fileKey: "owned",
    customId: `${scope.prefix}${crypto.randomUUID()}`,
  });
  const attempted: string[] = [];
  expect(
    await SafetyCleanup.run(database, scope, async (key) => {
      attempted.push(key);
      return { success: false };
    }),
  ).toEqual({ deleted: 0, failed: 1 });
  expect(attempted).toEqual(["owned"]);
  expect(
    (await database.select().from(schema.FileDeletion)).map(
      (file) => file.fileKey,
    ),
  ).toEqual(["owned"]);
  expect(
    await SafetyCleanup.run(database, scope, async () => {
      throw new Error("Storage offline");
    }),
  ).toEqual({ deleted: 0, failed: 1 });
  expect(
    await SafetyCleanup.run(database, scope, async () => ({ success: true })),
  ).toEqual({ deleted: 1, failed: 0 });
  expect(await database.select().from(schema.FileDeletion)).toHaveLength(0);
  expect(await database.select().from(schema.PreviewUpload)).toHaveLength(0);
});

test("account-local suspension disappears on deletion and never creates an enforcement fingerprint", async () => {
  await reportedAccount();
  await Moderation.resolve(database, "serious", {
    action: "suspend",
    expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  });
  expect(await ContentAccess.status(database, "bob")).toEqual({
    status: "suspended",
  });
  await AccountDeletion.remove(database, "bob", undefined);
  expect(await database.select().from(schema.AbuseEnforcement)).toHaveLength(0);
  expect(await database.select().from(schema.AccountSuspension)).toHaveLength(
    0,
  );
});

test("daily retention cleanup purges old reports and preserves recent pending reports", async () => {
  await database.insert(schema.AbuseReport).values([
    {
      id: "old",
      reporterId: "alice",
      reportedUserId: "bob",
      reason: "spam",
      details: "Expired allegation",
      createdAt: new Date(Date.now() - 31 * 86400_000),
    },
    {
      id: "new",
      reporterId: "alice",
      reportedUserId: "bob",
      reason: "spam",
      details: "Recent allegation",
    },
  ]);
  await SafetyCleanup.run(database, undefined, async () => ({ success: true }));
  expect(
    (await database.select().from(schema.AbuseReport)).map(
      (report) => report.id,
    ),
  ).toEqual(["new"]);
});
