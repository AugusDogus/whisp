import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod/v4";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((dir) => rm(dir, { recursive: true })),
  );
});

async function discover(databases: unknown, status = 200) {
  const dir = await mkdtemp(join(tmpdir(), "whisp-preview-discovery-test-"));
  directories.push(dir);
  await writeFile(join(dir, "output"), "");
  await writeFile(
    join(dir, "gh"),
    `#!/bin/sh
case "$2" in
  repos/example/whisp/pulls/17|repos/example/whisp/pulls/19) echo closed ;;
  repos/example/whisp/pulls/18) echo open ;;
  *) exit 1 ;;
esac
`,
    { mode: 0o755 },
  );
  await writeFile(
    join(dir, "mock.ts"),
    `
import { mock } from "bun:test";
mock.module(${JSON.stringify(import.meta.resolve("uploadthing/server"))}, () => ({
  UTApi: class {
    async listFiles() {
      return {
        files: [
          { key: "late", customId: "whisp-pr-19:00000000-0000-4000-8000-000000000001", status: "Uploaded" },
          { key: "production", customId: null, status: "Uploaded" },
        ],
        hasMore: false,
      };
    }
    async deleteFiles() { throw new Error("Discovery must not delete files"); }
  },
}));
globalThis.fetch = async (url, options) => {
  if (url !== "https://api.turso.tech/v1/organizations/example/databases" ||
      options?.headers?.Authorization !== "Bearer test-token") {
    throw new Error("Unexpected Turso request");
  }
  return Response.json(${JSON.stringify(databases)}, { status: ${status} });
};
`,
  );
  const child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      join(dir, "mock.ts"),
      join(import.meta.dir, "preview-uploads.ts"),
      "discover",
    ],
    {
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        UPLOADTHING_TOKEN: "test-token",
        TURSO_API_TOKEN: "test-token",
        TURSO_ORGANIZATION: "example",
        GH_REPO: "example/whisp",
        GITHUB_OUTPUT: join(dir, "output"),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return {
    exitCode,
    stderr,
    output: await readFile(join(dir, "output"), "utf8"),
  };
}

test("sweep finds databases without uploads, keeps late uploads, and excludes open PRs and unrelated names", async () => {
  const result = await discover({
    databases: [
      "whisp",
      "whisp-pr-17",
      "whisp-pr-18",
      "whisp-pr-19",
      "whisp-pr-0",
      "whisp-pr-017",
      "whisp-pr-20-backup",
    ].map((Name) => ({ Name })),
  });
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const output = z
    .array(z.string())
    .parse(JSON.parse(result.output.trim().slice("prs=".length)));
  expect(output.toSorted()).toEqual(["17", "19"]);
});

test("sweep still discovers late uploads when their database is already absent", async () => {
  const result = await discover({ databases: [] });
  expect(result.exitCode).toBe(0);
  expect(result.output).toBe('prs=["19"]\n');
});

test.each([401, 429, 500])(
  "Turso HTTP %s fails discovery without publishing a partial cleanup list",
  async (status) => {
    const result = await discover({ error: "unavailable" }, status);
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toBe("");
    expect(result.stderr).toContain(`HTTP ${status}`);
  },
);

test("malformed Turso responses fail discovery", async () => {
  const result = await discover({ databases: [{ name: "whisp-pr-17" }] });
  expect(result.exitCode).not.toBe(0);
  expect(result.output).toBe("");
});
