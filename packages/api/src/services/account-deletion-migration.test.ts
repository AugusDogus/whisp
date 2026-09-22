import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as schema from "@acme/db/schema";

import { AccountDeletion } from "./account-deletion";

test("production migrator preserves valid records, removes legacy orphans, and installs cascading deletion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "whisp-migration-"));
  const client = createClient({ url: `file:${join(directory, "test.db")}` });
  const db = drizzle({ client, schema });
  try {
    for (const name of [
      "0000_baseline",
      "0001_discord_cosmetics",
      "0002_push_token_sessions",
      "0003_account_safety",
    ]) {
      await client.executeMultiple(
        await Bun.file(
          new URL(`../../../db/drizzle/${name}.sql`, import.meta.url),
        ).text(),
      );
    }
    await db.insert(schema.user).values({
      id: "kept",
      name: "Kept",
      email: "kept@example.com",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db
      .insert(schema.Group)
      .values({ id: "g", createdById: "kept", name: "Kept group" });
    await db.insert(schema.Message).values([
      {
        id: "valid",
        senderId: "kept",
        groupId: "g",
        fileKey: "valid-file",
        fileUrl: "https://test.ufs.sh/f/valid-file",
      },
      {
        id: "orphan",
        senderId: "deleted",
        fileKey: "orphan-file",
        fileUrl: "https://test.ufs.sh/f/orphan-file",
      },
    ]);
    await db.insert(schema.MessageDelivery).values({
      id: "delivery",
      messageId: "valid",
      recipientId: "kept",
      groupId: "g",
    });
    await client.execute(
      "INSERT INTO account_suspension (userId, createdAt) VALUES ('kept', 1)",
    );
    // Mark the already deployed migrations exactly as the real migrator does.
    const journal: unknown = await Bun.file(
      new URL("../../../db/drizzle/meta/_journal.json", import.meta.url),
    ).json();
    const { z } = await import("zod/v4");
    const entries = z
      .object({
        entries: z.array(z.object({ tag: z.string(), when: z.number() })),
      })
      .parse(journal).entries;
    const previous = entries.find(
      (entry) => entry.tag === "0003_account_safety",
    );
    if (!previous) throw new Error("Missing baseline migration timestamp");
    await client.execute(
      "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)",
    );
    await client.execute({
      sql: "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('fixture', ?)",
      args: [previous.when],
    });
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../db/drizzle", import.meta.url),
      ),
    });
    expect((await db.select().from(schema.Message)).map((m) => m.id)).toEqual([
      "valid",
    ]);
    expect(await db.select().from(schema.MessageDelivery)).toHaveLength(1);
    expect(await db.select().from(schema.Group)).toHaveLength(1);
    expect(await db.select().from(schema.AccountSuspension)).toHaveLength(1);
    expect(
      (await db.select().from(schema.FileDeletion)).map((f) => f.fileKey),
    ).toEqual(["orphan-file"]);
    expect(
      (await client.execute("PRAGMA foreign_key_check")).rows,
    ).toHaveLength(0);
    await AccountDeletion.remove(db, "kept", undefined);
    expect(await db.select().from(schema.Message)).toHaveLength(0);
    expect(await db.select().from(schema.MessageDelivery)).toHaveLength(0);
    expect(await db.select().from(schema.AccountSuspension)).toHaveLength(0);
  } finally {
    client.close();
    rmSync(directory, { recursive: true });
  }
});
