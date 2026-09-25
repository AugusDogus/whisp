import { createClient } from "@libsql/client";
import { afterAll, beforeEach } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as schema from "@acme/db/schema";
import { CONTENT_POLICY_VERSION } from "@acme/validators";

export async function createSafetyTestDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "whisp-safety-test-"));
  const client = createClient({ url: `file:${join(directory, "test.db")}` });
  const database = drizzle({ client, schema });
  for (const file of [
    "0000_baseline.sql",
    "0001_discord_cosmetics.sql",
    "0002_push_token_sessions.sql",
    "0003_account_safety.sql",
    "0004_account_lifecycle.sql",
    "0005_file_deletion_attempts.sql",
  ]) {
    await client.executeMultiple(
      await Bun.file(
        new URL(`../../../db/drizzle/${file}`, import.meta.url),
      ).text(),
    );
  }

  beforeEach(async () => {
    for (const table of [
      schema.FileDeletion,
      schema.AbuseEnforcement,
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

  return database;
}
