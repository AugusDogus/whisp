import type { Client, InStatement } from "@libsql/client";

import { readMigrationFiles } from "drizzle-orm/migrator";

/** Branch previews can already contain migrations that were reordered by a
 * rebase. Match Drizzle receipts by content so neither those migrations nor
 * newer main migrations are skipped or applied twice.
 */
export async function applyMigrations(
  client: Client,
  config: { migrationsFolder: string },
) {
  const migrations = readMigrationFiles(config);
  await client.execute(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC
  )`);
  const receipts = await client.execute(
    "SELECT hash FROM __drizzle_migrations",
  );
  const applied = new Set(receipts.rows.map((row) => row.hash));
  const statements: InStatement[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.hash)) continue;
    statements.push(...migration.sql);
    statements.push({
      sql: "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      args: [migration.hash, migration.folderMillis],
    });
  }
  // libSQL's migration batch commits schema changes and receipts atomically.
  if (statements.length) await client.migrate(statements);
}
