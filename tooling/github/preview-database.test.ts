import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directories: string[] = [];
const script = join(import.meta.dir, "preview-database.sh");
const database = { database: { Hostname: "whisp-pr-42-example.turso.io" } };
const source = { database: { group: "default" } };

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((dir) => rm(dir, { recursive: true })),
  );
});

async function run(
  action: string,
  responses: { status: number; body?: unknown }[],
  prNumber = "42",
) {
  const dir = await mkdtemp(join(tmpdir(), "whisp-preview-test-"));
  directories.push(dir);
  await writeFile(join(dir, "responses.json"), JSON.stringify(responses));
  await writeFile(join(dir, "requests.jsonl"), "");
  await writeFile(join(dir, "env"), "");
  // Stub curl, so no test can reach Turso or use real credentials.
  await writeFile(
    join(dir, "curl"),
    `#!${process.execPath}
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const dir = process.env.MOCK_DIRECTORY;
const requests = readFileSync(dir + "/requests.jsonl", "utf8").trim();
const index = requests ? requests.split("\\n").length : 0;
const response = JSON.parse(readFileSync(dir + "/responses.json", "utf8"))[index];
appendFileSync(dir + "/requests.jsonl", JSON.stringify(args) + "\\n");
if (!response) process.exit(99);
writeFileSync(args[args.indexOf("--output") + 1], JSON.stringify(response.body ?? {}));
process.stdout.write(String(response.status));
`,
    { mode: 0o755 },
  );
  const child = Bun.spawn(["bash", script, action], {
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      MOCK_DIRECTORY: dir,
      PR_NUMBER: prNumber,
      TURSO_ORGANIZATION: "example",
      TURSO_SOURCE_DATABASE: "whisp",
      TURSO_API_TOKEN: "test-api-token",
      GITHUB_ENV: join(dir, "env"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return {
    exitCode,
    stdout,
    stderr,
    env: await readFile(join(dir, "env"), "utf8"),
    requests: await readFile(join(dir, "requests.jsonl"), "utf8"),
  };
}

test("branches the main database in its existing group and exports credentials", async () => {
  const result = await run("ensure", [
    { status: 404 },
    { status: 200, body: source },
    { status: 200, body: database },
    { status: 200, body: { jwt: "test-database-token" } },
  ]);
  expect(result.exitCode).toBe(0);
  expect(result.requests).toContain('\\"name\\": \\"whisp-pr-42\\"');
  expect(result.requests).toContain('/databases/whisp"');
  expect(result.requests).toContain('\\"group\\": \\"default\\"');
  expect(result.requests).toContain('\\"seed\\":');
  expect(result.requests).toContain('\\"type\\": \\"database\\"');
  expect(result.requests).toContain('\\"name\\": \\"whisp\\"');
  expect(result.requests).toContain("expiration=never");
  expect(result.env).toBe(
    "DATABASE_URL=libsql://whisp-pr-42-example.turso.io\nDATABASE_TOKEN=test-database-token\n",
  );
  expect(result.stdout).toContain("::add-mask::test-database-token");
});

test("reuses an existing database without resetting data", async () => {
  const result = await run("ensure", [
    { status: 200, body: database },
    { status: 200, body: { jwt: "test-database-token" } },
  ]);
  expect(result.exitCode).toBe(0);
  expect(result.requests.trim().split("\n")).toHaveLength(2);
  expect(result.requests).not.toContain("--data");
});

test("does not create an empty database when the source is missing", async () => {
  const result = await run("ensure", [{ status: 404 }, { status: 404 }]);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("source lookup");
  expect(result.requests).not.toContain('"POST"');
  expect(result.env).toBe("");
});

test("rejects a source response without a valid group", async () => {
  const result = await run("ensure", [
    { status: 404 },
    { status: 200, body: { database: {} } },
  ]);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("no valid group");
  expect(result.requests).not.toContain('"POST"');
});

test("does not mistake an authentication failure for a missing database", async () => {
  const result = await run("ensure", [{ status: 401 }]);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("HTTP 401");
  expect(result.requests.trim().split("\n")).toHaveLength(1);
  expect(result.env).toBe("");
});

test("rejects malformed database responses before exporting credentials", async () => {
  const result = await run("ensure", [
    { status: 200, body: { database: { Hostname: "host\nOTHER=value" } } },
  ]);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("no valid hostname");
  expect(result.env).toBe("");
});

test("does not export credentials when token creation fails", async () => {
  const result = await run("ensure", [
    { status: 200, body: database },
    { status: 503 },
  ]);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("HTTP 503");
  expect(result.env).toBe("");
});

test.each([200, 204, 404])("cleanup accepts HTTP %s", async (status) => {
  const result = await run("destroy", [{ status }]);
  expect(result.exitCode).toBe(0);
  expect(result.requests).toContain('"DELETE"');
  expect(result.requests).toContain("/databases/whisp-pr-42");
});

test.each([403, 429, 500])(
  "cleanup reports HTTP %s as failure",
  async (status) => {
    const result = await run("destroy", [{ status }]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(`HTTP ${status}`);
  },
);

test.each(["", "0", "../production", "42/../production", "42\n43"])(
  "rejects invalid PR number %j before accessing Turso",
  async (prNumber) => {
    const result = await run("destroy", [], prNumber);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("PR_NUMBER must be a positive integer");
    expect(result.requests).toBe("");
  },
);
