import { createClient } from "@libsql/client";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PreviewScope } from "../../packages/api/src/uploadthing/preview-scope";
import { resetInheritedPushTokens } from "./preview-push-tokens";

const clients: ReturnType<typeof createClient>[] = [];
const directories: string[] = [];
afterEach(async () => {
  clients.splice(0).forEach((client) => client.close());
  await Promise.all(
    directories.splice(0).map((dir) => rm(dir, { recursive: true })),
  );
});

async function fixture() {
  // libSQL transactions acquire a separate connection; use a file so all
  // connections see the same database throughout the transaction.
  const dir = await mkdtemp(join(tmpdir(), "whisp-push-reset-test-"));
  directories.push(dir);
  const client = createClient({ url: `file:${join(dir, "database.db")}` });
  clients.push(client);
  await client.execute(
    "CREATE TABLE push_token (id TEXT PRIMARY KEY, token TEXT NOT NULL)",
  );
  await client.execute(
    "CREATE TABLE preview_push_token_reset (scope TEXT PRIMARY KEY NOT NULL)",
  );
  await client.execute(
    "INSERT INTO push_token VALUES ('production-device', 'production-token')",
  );
  return client;
}

test("initialization clears inherited device registrations only in the preview", async () => {
  const source = await fixture();
  const preview = await fixture();
  await resetInheritedPushTokens(preview, PreviewScope.parse("17"));
  expect((await preview.execute("SELECT * FROM push_token")).rows).toHaveLength(
    0,
  );
  expect((await source.execute("SELECT * FROM push_token")).rows).toHaveLength(
    1,
  );
});

test("redeployments retain devices registered with the preview", async () => {
  const preview = await fixture();
  const scope = PreviewScope.parse("17");
  await resetInheritedPushTokens(preview, scope);
  await preview.execute(
    "INSERT INTO push_token VALUES ('preview-device', 'preview-token')",
  );
  await resetInheritedPushTokens(preview, scope);
  expect(
    (await preview.execute("SELECT token FROM push_token")).rows.map(
      (row) => row.token,
    ),
  ).toEqual(["preview-token"]);
});

test("a failed reset rolls back the marker so retries still clear inherited tokens", async () => {
  const preview = await fixture();
  await preview.execute(
    "CREATE TRIGGER fail_delete BEFORE DELETE ON push_token BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  await expect(
    resetInheritedPushTokens(preview, PreviewScope.parse("17")),
  ).rejects.toThrow();
  expect(
    (await preview.execute("SELECT * FROM preview_push_token_reset")).rows,
  ).toHaveLength(0);
  await preview.execute("DROP TRIGGER fail_delete");
  await resetInheritedPushTokens(preview, PreviewScope.parse("17"));
  expect((await preview.execute("SELECT * FROM push_token")).rows).toHaveLength(
    0,
  );
});
