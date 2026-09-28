import { createClient } from "@libsql/client";
import { afterEach, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { migrate as migrateByTimestamp } from "drizzle-orm/libsql/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import journal from "../../packages/db/drizzle/meta/_journal.json";
import { applyMigrations as migrate } from "../../packages/db/scripts/apply-migrations";

const source = resolve(import.meta.dir, "../../packages/db/drizzle");
const directories: string[] = [];
const clients: ReturnType<typeof createClient>[] = [];
afterEach(async () => {
  clients.splice(0).forEach((client) => client.close());
  await Promise.all(
    directories.splice(0).map((dir) => rm(dir, { recursive: true })),
  );
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "whisp-migrations-"));
  directories.push(dir);
  const client = createClient({ url: `file:${join(dir, "db.sqlite")}` });
  clients.push(client);
  const migrationsFolder = join(dir, "drizzle");
  await cp(source, migrationsFolder, { recursive: true });
  // Lifecycle fixtures stay on the baseline as real migrations are added.
  await writeFile(
    join(migrationsFolder, "meta/_journal.json"),
    JSON.stringify({
      ...journal,
      entries: journal.entries.slice(0, 1),
    }),
  );
  return { dir, client, migrationsFolder };
}

async function addMigration(directory: string, sql: string) {
  const previous = journal.entries[0];
  if (!previous) throw new Error("The baseline migration is missing");
  const tag = "0001_test";
  await writeFile(join(directory, `${tag}.sql`), sql);
  await writeFile(
    join(directory, "meta/_journal.json"),
    JSON.stringify({
      ...journal,
      entries: [
        previous,
        { ...previous, idx: previous.idx + 1, when: previous.when + 1, tag },
      ],
    }),
  );
}

test("baseline adopts the existing production schema and history without losing users", async () => {
  const { client, migrationsFolder } = await fixture();
  const baseline = readMigrationFiles({ migrationsFolder })[0];
  if (!baseline) throw new Error("The baseline migration is missing");
  // Model the existing db:push database with older migration receipts.
  await client.migrate(baseline.sql);
  await client.executeMultiple(`
    INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('existing', 'Existing', 'test@example.com', 1, 1, 1);
    CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC);
    INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('historical', 1772314311618);
  `);
  await migrate(client, { migrationsFolder });
  await migrate(client, { migrationsFolder });
  expect((await client.execute("SELECT name FROM user")).rows).toEqual([
    { name: "Existing" },
  ]);
  expect(
    (await client.execute("SELECT * FROM __drizzle_migrations")).rows,
  ).toHaveLength(2);
});

test("forward schema and data changes run once after the baseline", async () => {
  const { client, migrationsFolder } = await fixture();
  await migrate(client, { migrationsFolder });
  await client.execute(
    "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('1', 'Old name', 'test@example.com', 1, 1, 1)",
  );
  await addMigration(
    migrationsFolder,
    "ALTER TABLE user ADD COLUMN cosmetic TEXT;\n--> statement-breakpoint\nUPDATE user SET name = name || ' updated', cosmetic = 'saved';",
  );
  await migrate(client, { migrationsFolder });
  await migrate(client, { migrationsFolder });
  expect(
    (await client.execute("SELECT name, cosmetic FROM user")).rows,
  ).toEqual([{ name: "Old name updated", cosmetic: "saved" }]);
  expect(
    (await client.execute("SELECT * FROM __drizzle_migrations")).rows,
  ).toHaveLength(2);
});

test("registered MLS migration upgrades an existing database and runs once", async () => {
  const { client, migrationsFolder } = await fixture();
  await migrate(client, { migrationsFolder });
  await client.execute(
    "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('existing', 'Existing', 'test@example.com', 1, 1, 1)",
  );
  await migrate(client, { migrationsFolder: source });
  await migrate(client, { migrationsFolder: source });
  expect((await client.execute("SELECT name FROM user")).rows).toEqual([
    { name: "Existing" },
  ]);
  expect(
    (
      await client.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'mls_%' ORDER BY name",
      )
    ).rows.map((row) => row.name),
  ).toEqual([
    "mls_application_attempt",
    "mls_conversation",
    "mls_device",
    "mls_draft",
    "mls_draft_conversation",
    "mls_event",
    "mls_key_package",
    "mls_operation",
    "mls_welcome",
  ]);
  expect(
    (await client.execute("SELECT * FROM __drizzle_migrations")).rows,
  ).toHaveLength(journal.entries.length);
});

test("MLS migration adopts tables created by earlier preview schema pushes without losing messages", async () => {
  const { client, migrationsFolder } = await fixture();
  await migrate(client, { migrationsFolder });
  // The old preview workflow applied the schema without a migration receipt.
  await client.executeMultiple(
    await readFile(join(source, "0003_mls.sql"), "utf8"),
  );
  await client.executeMultiple(`
    INSERT INTO mls_conversation (id, scope, users, members) VALUES ('conversation', 'direct', '[]', '[]');
  `);
  // Event rows have always stored a JSON envelope around the MLS ciphertext.
  const entry = JSON.stringify({
    kind: "application",
    data: "encrypted whisp",
    senderId: "sender",
    senderDeviceId: "sender-device",
    messageId: "message",
    groupId: null,
  });
  await client.execute({
    sql: "INSERT INTO mls_event (id, conversationId, sequence, entry) VALUES ('event', 'conversation', 1, ?)",
    args: [entry],
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await migrate(client, { migrationsFolder: source });
  }
  expect((await client.execute("SELECT entry FROM mls_event")).rows).toEqual([
    { entry },
  ]);
  expect(
    (await client.execute("SELECT epoch FROM mls_conversation")).rows,
  ).toEqual([{ epoch: 0 }]);
  expect((await client.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
  expect(
    (await client.execute("SELECT * FROM __drizzle_migrations")).rows,
  ).toHaveLength(journal.entries.length);
});

test.each(["main", "preview"] as const)(
  "rebased migrations preserve the existing %s database history",
  async (history) => {
    const { client, migrationsFolder } = await fixture();
    const entries =
      history === "main"
        ? journal.entries.slice(0, 3)
        : // The preview database predates main's session migration and every
          // migration added after 0005, so its history stops there.
          journal.entries
            .filter((entry) => entry.tag !== "0002_push_token_sessions")
            .slice(0, 5)
            .map((entry, idx) => ({
              ...entry,
              idx,
              when: [
                1789800959047, 1789801233176, 1789803323810, 1789957550912,
                1790017079446,
              ][idx],
            }));
    await writeFile(
      join(migrationsFolder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries }),
    );
    // Seed receipts with the original timestamp-based deployment runner.
    await migrateByTimestamp(drizzle(client), { migrationsFolder });
    await client.execute(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('existing', 'Existing', 'test@example.com', 1, 1, 1)",
    );
    if (history === "preview")
      await client.execute(
        "INSERT INTO mls_conversation (id, scope, users, members, epoch) VALUES ('existing', 'direct', '[]', '[]', 7)",
      );
    await migrate(client, { migrationsFolder: source });
    await migrate(client, { migrationsFolder: source });
    expect((await client.execute("SELECT name FROM user")).rows).toEqual([
      { name: "Existing" },
    ]);
    expect(
      (await client.execute("PRAGMA table_info(push_token)")).rows.map(
        (row) => row.name,
      ),
    ).toContain("sessionId");
    expect(
      (await client.execute("PRAGMA table_info(mls_device)")).rows.map(
        (row) => row.name,
      ),
    ).toContain("name");
    expect(
      (await client.execute("PRAGMA table_info(mls_conversation)")).rows.map(
        (row) => row.name,
      ),
    ).toContain("epoch");
    if (history === "preview")
      expect(
        (
          await client.execute(
            "SELECT epoch FROM mls_conversation WHERE id = 'existing'",
          )
        ).rows,
      ).toEqual([{ epoch: 7 }]);
    expect(
      (await client.execute("SELECT * FROM __drizzle_migrations")).rows,
    ).toHaveLength(journal.entries.length);
    expect((await client.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
  },
);

test("a failed migration rolls back both schema changes and its receipt", async () => {
  const { client, migrationsFolder } = await fixture();
  await migrate(client, { migrationsFolder });
  await addMigration(
    migrationsFolder,
    "ALTER TABLE user ADD COLUMN broken TEXT;\n--> statement-breakpoint\nINSERT INTO nonexistent VALUES (1);",
  );
  await expect(migrate(client, { migrationsFolder })).rejects.toThrow();
  expect(
    (await client.execute("PRAGMA table_info(user)")).rows.map(
      (row) => row.name,
    ),
  ).not.toContain("broken");
  expect(
    (await client.execute("SELECT * FROM __drizzle_migrations")).rows,
  ).toHaveLength(1);
});

test("the deployment command initializes a fresh database and succeeds on redeploy", async () => {
  const { client } = await fixture();
  const databaseUrl = (await client.execute("PRAGMA database_list")).rows[0]
    ?.file;
  if (typeof databaseUrl !== "string")
    throw new Error("Missing fixture database path");
  for (let attempt = 0; attempt < 2; attempt++) {
    const child = Bun.spawn(
      [
        process.execPath,
        resolve(import.meta.dir, "../../packages/db/scripts/migrate.ts"),
      ],
      {
        env: {
          DATABASE_URL: `file:${databaseUrl}`,
          DATABASE_TOKEN: "test-token",
        },
        stdout: "ignore",
        stderr: "pipe",
      },
    );
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  }
  expect(
    (await client.execute("SELECT * FROM __drizzle_migrations")).rows,
  ).toHaveLength(journal.entries.length);
});

test.each([
  [
    "production",
    false,
    ["packages/db/scripts/migrate.ts", "run build --filter=@acme/nextjs..."],
  ],
  ["production", true, ["packages/db/scripts/migrate.ts"]],
  ["preview", false, ["run build --filter=@acme/nextjs..."]],
  ["development", false, ["run build --filter=@acme/nextjs..."]],
] as const)(
  "Vercel %s build waits for successful migration (failure=%s)",
  async (environment, fail, commands) => {
    const { dir } = await fixture();
    const log = join(dir, "commands");
    await writeFile(
      join(dir, "bun"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$COMMAND_LOG"\n${fail ? "exit 1" : "exit 0"}\n`,
      { mode: 0o755 },
    );
    const child = Bun.spawn(
      ["bash", join(import.meta.dir, "../vercel/build.sh")],
      {
        env: {
          PATH: `${dir}:${process.env.PATH}`,
          VERCEL_ENV: environment,
          COMMAND_LOG: log,
        },
        stdout: "ignore",
        stderr: "inherit",
      },
    );
    expect(await child.exited).toBe(fail ? 1 : 0);
    expect((await readFile(log, "utf8")).trim().split("\n")).toEqual([
      ...commands,
    ]);
  },
);
