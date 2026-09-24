import { createClient } from "@libsql/client";
import { afterAll, beforeEach, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "@acme/db";
import * as schema from "@acme/db/schema";
import { CONTENT_POLICY_VERSION } from "@acme/validators";

import { AbuseReports } from "./abuse-reports";
import { Blocking } from "./blocking";
import { ContentAccess } from "./content-access";
import { FriendRequests } from "./friend-requests";
import { MessageRecipients } from "./message-recipients";
import { Moderation } from "./moderation";

const directory = mkdtempSync(join(tmpdir(), "whisp-safety-test-"));
const client = createClient({ url: `file:${join(directory, "test.db")}` });
const database = drizzle({ client, schema });
for (const file of [
  "0000_baseline.sql",
  "0001_discord_cosmetics.sql",
  "0002_account_safety.sql",
]) {
  await client.executeMultiple(
    await Bun.file(
      new URL(`../../../db/drizzle/${file}`, import.meta.url),
    ).text(),
  );
}

beforeEach(async () => {
  for (const table of [
    schema.AbuseReport,
    schema.AccountSuspension,
    schema.ContentPolicyAcceptance,
    schema.UserBlock,
    schema.MessageDelivery,
    schema.Message,
    schema.GroupMember,
    schema.Group,
    schema.Friendship,
    schema.FriendRequest,
    schema.user,
  ]) {
    await database.delete(table);
  }
  for (const id of ["alice", "bob", "carol"]) {
    await database.insert(schema.user).values({
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await database
      .insert(schema.ContentPolicyAcceptance)
      .values({ userId: id, version: CONTENT_POLICY_VERSION });
  }
  await database.insert(schema.Friendship).values([
    { userIdA: "alice", userIdB: "bob" },
    { userIdA: "alice", userIdB: "carol" },
  ]);
});

afterAll(() => {
  client.close();
  rmSync(directory, { recursive: true });
});

test("blocking is idempotent, removes pending contact, and works in both directions", async () => {
  await database
    .insert(schema.FriendRequest)
    .values({ fromUserId: "bob", toUserId: "alice", status: "pending" });
  await database
    .insert(schema.Message)
    .values({ id: "m", senderId: "bob", fileUrl: "https://example.com/m" });
  await database
    .insert(schema.MessageDelivery)
    .values({ id: "d", messageId: "m", recipientId: "alice" });
  for (let i = 0; i < 2; i++)
    expect(
      await database.transaction((tx) => Blocking.block(tx, "alice", "bob")),
    ).toEqual({ status: "blocked" });
  expect(await Blocking.canContact(database, "alice", "bob")).toBe(false);
  expect(await Blocking.canContact(database, "bob", "alice")).toBe(false);
  expect(await Blocking.canContact(database, "alice", "carol")).toBe(true);
  expect(await database.select().from(schema.FriendRequest)).toHaveLength(0);
  expect(await database.select().from(schema.MessageDelivery)).toHaveLength(0);
  await database.delete(schema.UserBlock);
  expect(
    await MessageRecipients.resolve(database, "alice", { recipients: ["bob"] }),
  ).toEqual({ status: "unavailable" });
});

test("rejects self-blocking and missing accounts without writing", async () => {
  expect(await Blocking.block(database, "alice", "alice")).toEqual({
    status: "self",
  });
  expect(await Blocking.block(database, "alice", "missing")).toEqual({
    status: "missing",
  });
  expect(await database.select().from(schema.UserBlock)).toHaveLength(0);
});

test("an upload started before a block cannot deliver afterward", async () => {
  expect(
    await MessageRecipients.resolve(database, "alice", {
      recipients: ["bob", "bob"],
    }),
  ).toEqual({ status: "ready", recipientIds: ["bob"] });
  await database.transaction((tx) => Blocking.block(tx, "bob", "alice"));
  expect(
    await MessageRecipients.resolve(database, "alice", { recipients: ["bob"] }),
  ).toEqual({ status: "unavailable" });
});

test("shared groups exclude blocked recipients and require current membership", async () => {
  await database
    .insert(schema.Group)
    .values({ id: "g", name: "Friends", createdById: "alice" });
  await database
    .insert(schema.GroupMember)
    .values(
      ["alice", "bob", "carol"].map((userId) => ({ groupId: "g", userId })),
    );
  await database.transaction((tx) => Blocking.block(tx, "bob", "alice"));
  expect(
    await MessageRecipients.resolve(database, "alice", { groupId: "g" }),
  ).toEqual({ status: "ready", recipientIds: ["carol"] });
  await database
    .delete(schema.GroupMember)
    .where(eq(schema.GroupMember.userId, "alice"));
  expect(
    await MessageRecipients.resolve(database, "alice", { groupId: "g" }),
  ).toEqual({ status: "unavailable" });
});

test("sharing requires current acceptance and stops on suspension or account deletion", async () => {
  await database
    .update(schema.ContentPolicyAcceptance)
    .set({ version: "old" })
    .where(eq(schema.ContentPolicyAcceptance.userId, "alice"));
  expect(await ContentAccess.status(database, "alice")).toEqual({
    status: "acceptance_required",
  });
  expect(
    await MessageRecipients.resolve(database, "alice", { recipients: ["bob"] }),
  ).toEqual({ status: "restricted" });
  await database.insert(schema.AccountSuspension).values({ userId: "alice" });
  expect(await ContentAccess.status(database, "alice")).toEqual({
    status: "suspended",
  });
  expect(await ContentAccess.status(database, "missing")).toEqual({
    status: "unavailable",
  });
});

test("reports store account-level details, deduplicate pending reports, and reject invalid subjects", async () => {
  const input = {
    userId: "bob",
    reason: "spam",
    details: "Repeated unwanted requests",
    fileUrl: "https://example.com/private-photo",
  };
  for (let i = 0; i < 2; i++)
    expect(
      await database.transaction((tx) =>
        AbuseReports.submit(tx, "alice", input),
      ),
    ).toEqual({ status: "submitted" });
  const reports = await database.select().from(schema.AbuseReport);
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({
    reporterId: "alice",
    reportedUserId: "bob",
    reason: "spam",
    status: "pending",
  });
  expect(JSON.stringify(reports)).not.toContain("private-photo");
  expect(
    await AbuseReports.submit(database, "alice", { ...input, userId: "alice" }),
  ).toEqual({ status: "self" });
  expect(
    await AbuseReports.submit(database, "alice", {
      ...input,
      userId: "missing",
    }),
  ).toEqual({ status: "missing" });
  expect(
    await AbuseReports.submit(database, "alice", {
      ...input,
      details: "x".repeat(2001),
    }),
  ).toEqual({ status: "invalid" });
});

test("report quota limits abuse without preventing retries of an existing report", async () => {
  for (let i = 0; i < 10; i++)
    await database.insert(schema.AbuseReport).values({
      reporterId: "alice",
      reportedUserId: "bob",
      reason: "spam",
      details: "",
      status: "dismissed",
    });
  expect(
    await AbuseReports.submit(database, "alice", {
      userId: "carol",
      reason: "spam",
    }),
  ).toEqual({ status: "rate_limited" });
});

test("a new safety concern is saved even when the same account has a pending report", async () => {
  for (const reason of ["spam", "child_safety"]) {
    expect(
      await database.transaction((tx) =>
        AbuseReports.submit(tx, "alice", { userId: "bob", reason }),
      ),
    ).toEqual({ status: "submitted" });
  }
  const reports = await database.select().from(schema.AbuseReport);
  expect(reports).toHaveLength(2);
  expect(new Set(reports.map((report) => report.reason))).toEqual(
    new Set(["child_safety", "spam"]),
  );
});

test("blocked requests cannot be sent, accepted, or used to recreate a friendship", async () => {
  await database.delete(schema.Friendship);
  const request = await database.transaction((tx) =>
    FriendRequests.send(tx, "bob", "alice"),
  );
  expect(request.status).toBe("requested");
  if (request.status !== "requested")
    throw new Error("Expected a pending request");
  expect(
    await database.transaction((tx) =>
      FriendRequests.accept(tx, "carol", request.requestId),
    ),
  ).toEqual({ status: "unavailable" });
  await database.transaction((tx) => Blocking.block(tx, "alice", "bob"));
  expect(
    await database.transaction((tx) => FriendRequests.send(tx, "bob", "alice")),
  ).toEqual({ status: "unavailable" });
  expect(
    await database.transaction((tx) => FriendRequests.send(tx, "alice", "bob")),
  ).toEqual({ status: "unavailable" });
  expect(
    await database.transaction((tx) =>
      FriendRequests.accept(tx, "alice", request.requestId),
    ),
  ).toEqual({ status: "unavailable" });
  expect(await database.select().from(schema.Friendship)).toHaveLength(0);
});

test("moderation actions are atomic and stop sharing without disabling reports", async () => {
  await database.insert(schema.AbuseReport).values({
    id: "report",
    reporterId: "alice",
    reportedUserId: "bob",
    reason: "harassment",
    details: "",
  });
  expect(await Moderation.resolve(database, "report", "suspend")).toEqual({
    status: "resolved",
  });
  expect(await ContentAccess.status(database, "bob")).toEqual({
    status: "suspended",
  });
  expect(
    await MessageRecipients.resolve(database, "bob", { recipients: ["alice"] }),
  ).toEqual({ status: "restricted" });
  expect(await FriendRequests.send(database, "bob", "carol")).toEqual({
    status: "unavailable",
  });
  expect(
    await AbuseReports.submit(database, "bob", {
      userId: "carol",
      reason: "spam",
    }),
  ).toEqual({ status: "submitted" });
  expect(await Moderation.resolve(database, "report", "dismiss")).toEqual({
    status: "already_reviewed",
  });
  expect(
    (
      await database
        .select()
        .from(schema.AbuseReport)
        .where(eq(schema.AbuseReport.id, "report"))
    )[0]?.status,
  ).toBe("actioned");
});
