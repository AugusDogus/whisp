import { createClient } from "@libsql/client";
import { afterAll, beforeEach, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@acme/db/schema";

import { PreviewScope } from "./preview-scope";
import { PreviewUploads } from "./preview-uploads";

const client = createClient({ url: "file::memory:" });
const db = drizzle({ client, schema });
const scope = PreviewScope.parse("17");
const customId = `${scope.prefix}00000000-0000-4000-8000-000000000001`;

beforeEach(async () => {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS preview_upload_control (scope TEXT PRIMARY KEY, state TEXT NOT NULL)",
  );
  await client.execute(
    "CREATE TABLE IF NOT EXISTS preview_upload (fileKey TEXT PRIMARY KEY, customId TEXT NOT NULL)",
  );
  await client.execute("DELETE FROM preview_upload_control");
  await client.execute("DELETE FROM preview_upload");
});
afterAll(() => client.close());

test("production and local uploads need no preview tables", async () => {
  expect(
    PreviewScope.fromEnvironment({ VERCEL_ENV: "production" }),
  ).toBeUndefined();
  expect(await PreviewUploads.canDelete(db, undefined, "production-key")).toBe(
    true,
  );
});

test("a Vercel preview without valid scope fails closed", () => {
  expect(() =>
    PreviewScope.fromEnvironment({ VERCEL_ENV: "preview" }),
  ).toThrow();
  expect(() => PreviewScope.parse("17\n18")).toThrow();
  expect(() => PreviewScope.parse("17\n")).toThrow();
  expect(() => PreviewScope.parse("17\r")).toThrow();
  expect(PreviewScope.owns(scope, `${customId}\n`)).toBe(false);
  expect(() =>
    PreviewScope.fromEnvironment({
      VERCEL_ENV: "production",
      PREVIEW_PR_NUMBER: "17",
    }),
  ).toThrow();
});

test("only an explicitly open preview can issue uploads", async () => {
  await expect(PreviewUploads.assertOpen(db, scope)).rejects.toThrow(
    "closed or not initialized",
  );
  await db
    .insert(schema.PreviewUploadControl)
    .values({ scope: scope.prefix, state: "open" });
  await PreviewUploads.assertOpen(db, scope);
  await db.update(schema.PreviewUploadControl).set({ state: "closed" });
  await expect(PreviewUploads.assertOpen(db, scope)).rejects.toThrow(
    "closed or not initialized",
  );
});

test("preview deletion skips inherited and other PR files", async () => {
  await PreviewUploads.record(db, scope, { key: "own", customId });
  await PreviewUploads.record(db, PreviewScope.parse("18"), {
    key: "other",
    customId: customId.replace("17:", "18:"),
  });
  expect(await PreviewUploads.canDelete(db, scope, "own")).toBe(true);
  expect(await PreviewUploads.canDelete(db, scope, "production-key")).toBe(
    false,
  );
  expect(await PreviewUploads.canDelete(db, scope, "other")).toBe(false);
});

test("callbacks cannot record untagged or foreign files as preview-owned", async () => {
  await expect(
    PreviewUploads.record(db, scope, { key: "key", customId: null }),
  ).rejects.toThrow();
  await expect(
    PreviewUploads.record(db, scope, {
      key: "key",
      customId: customId.replace("17:", "18:"),
    }),
  ).rejects.toThrow();
  expect(await PreviewUploads.canDelete(db, scope, "key")).toBe(false);
});
