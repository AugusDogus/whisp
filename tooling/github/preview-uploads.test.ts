import { createClient } from "@libsql/client";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((dir) => rm(dir, { recursive: true })),
  );
});

async function close(prState: "open" | "closed" | "error", listFails = false) {
  const dir = await mkdtemp(join(tmpdir(), "whisp-upload-cleanup-test-"));
  directories.push(dir);
  const url = `file:${join(dir, "preview.db")}`;
  const client = createClient({ url });
  await client.execute(
    "CREATE TABLE preview_upload_control (scope TEXT PRIMARY KEY, state TEXT NOT NULL)",
  );
  await client.execute(
    "INSERT INTO preview_upload_control VALUES ('whisp-pr-17:', 'open')",
  );
  await writeFile(join(dir, "output"), "");
  await writeFile(
    join(dir, "gh"),
    `#!/bin/sh\n${prState === "error" ? "exit 1" : `echo ${prState}`}\n`,
    { mode: 0o755 },
  );
  await writeFile(
    join(dir, "mock.ts"),
    `
import { mock } from "bun:test";
mock.module(${JSON.stringify(import.meta.resolve("uploadthing/server"))}, () => ({
  UTApi: class {
    async listFiles() {
      if (${listFails}) throw new Error("UploadThing unavailable");
      return { files: [], hasMore: false };
    }
    async deleteFiles() { throw new Error("No fixture file should be deleted"); }
  },
}));
`,
  );
  const child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      join(dir, "mock.ts"),
      join(import.meta.dir, "preview-uploads.ts"),
      "close",
    ],
    {
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        DATABASE_URL: url,
        DATABASE_TOKEN: "test-token",
        UPLOADTHING_TOKEN: "test-token",
        PR_NUMBER: "17",
        GH_REPO: "example/whisp",
        GITHUB_OUTPUT: join(dir, "output"),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const state = (
    await client.execute("SELECT state FROM preview_upload_control")
  ).rows[0]?.state;
  client.close();
  return {
    exitCode,
    stdout,
    stderr,
    state,
    output: await readFile(join(dir, "output"), "utf8"),
  };
}

test("a reopened PR preserves upload access and never authorizes database deletion", async () => {
  const result = await close("open");
  expect(result.exitCode).toBe(0);
  expect(result.state).toBe("open");
  expect(result.output).toBe("");
});

test("a closed PR disables uploads before authorizing database deletion", async () => {
  const result = await close("closed");
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(result.state).toBe("closed");
  expect(result.output).toBe("closed=true\n");
});

test("UploadThing failure leaves uploads disabled and prevents database deletion", async () => {
  const result = await close("closed", true);
  expect(result.exitCode).not.toBe(0);
  expect(result.state).toBe("closed");
  expect(result.output).toBe("");
});

test("a GitHub API failure preserves the preview", async () => {
  const result = await close("error");
  expect(result.exitCode).not.toBe(0);
  expect(result.state).toBe("open");
  expect(result.output).toBe("");
});
