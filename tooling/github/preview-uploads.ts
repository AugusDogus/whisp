import { createClient } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { UTApi } from "uploadthing/server";
import { z } from "zod/v4";

import { PreviewCleanup } from "../../packages/api/src/uploadthing/preview-cleanup";
import { PreviewScope } from "../../packages/api/src/uploadthing/preview-scope";
import { resetInheritedPushTokens } from "./preview-push-tokens";

function required(name: string) {
  return z
    .string()
    .min(1, `Set ${name} before managing preview uploads.`)
    .parse(process.env[name]);
}

async function setState(scope: PreviewScope, state: "open" | "closed") {
  // A cleanup retry can find that the database is already absent.
  if (state === "closed" && !process.env.DATABASE_URL) return;
  const client = createClient({
    url: required("DATABASE_URL"),
    authToken: required("DATABASE_TOKEN"),
  });
  try {
    if (state === "open") await resetInheritedPushTokens(client, scope);
    // Supports cleanup of databases created before upload tracking was installed.
    await client.execute(
      "CREATE TABLE IF NOT EXISTS preview_upload_control (scope TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)",
    );
    await client.execute({
      sql: "INSERT INTO preview_upload_control (scope, state) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET state = excluded.state",
      args: [scope.prefix, state],
    });
  } finally {
    client.close();
  }
}

function prState(prNumber: string) {
  const repo = z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .parse(required("GH_REPO"));
  return z
    .enum(["open", "closed"])
    .parse(
      execFileSync(
        "gh",
        ["api", `repos/${repo}/pulls/${prNumber}`, "--jq", ".state"],
        { encoding: "utf8" },
      ).trim(),
    );
}

async function discoverDatabasePrs(): Promise<string[]> {
  const organization = z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .parse(required("TURSO_ORGANIZATION"));
  const response = await fetch(
    `https://api.turso.tech/v1/organizations/${organization}/databases`,
    {
      headers: { Authorization: `Bearer ${required("TURSO_API_TOKEN")}` },
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Turso database discovery failed for ${organization} (HTTP ${response.status}). No cleanup was scheduled; check the API token and Turso status, then rerun the sweep.`,
    );
  }
  const { databases } = z
    .object({ databases: z.array(z.object({ Name: z.string() })) })
    .parse(await response.json());
  return databases.flatMap(({ Name }) => {
    const match = Name.match(/^whisp-pr-([1-9][0-9]*)$/);
    return match?.[0] === Name && match[1] ? [match[1]] : [];
  });
}

async function main() {
  const action = z.enum(["open", "close", "discover"]).parse(process.argv[2]);
  if (action === "open") {
    await setState(PreviewScope.parse(required("PR_NUMBER")), "open");
    return;
  }
  const store = new UTApi({ token: required("UPLOADTHING_TOKEN") });
  if (action === "discover") {
    // Files can already be gone when database deletion fails. Conversely, late
    // uploads can outlive the database. Reconcile both resource inventories.
    const [uploads, databases] = await Promise.all([
      PreviewCleanup.discover(store),
      discoverDatabasePrs(),
    ]);
    const prs = [...new Set([...uploads, ...databases])].filter(
      (pr) => prState(pr) === "closed",
    );
    appendFileSync(required("GITHUB_OUTPUT"), `prs=${JSON.stringify(prs)}\n`);
    return;
  }
  const scope = PreviewScope.parse(required("PR_NUMBER"));
  const state = prState(scope.prNumber);
  if (state !== "closed") {
    console.log(`PR ${scope.prNumber} is open; no files were deleted.`);
    return;
  }
  await setState(scope, "closed");
  const result = await PreviewCleanup.deleteFiles(store, scope);
  console.log(
    `PR ${scope.prNumber}: requested deletion of ${result.requested} files; ${result.uploading} in-flight uploads will be handled by a later sweep.`,
  );
  appendFileSync(required("GITHUB_OUTPUT"), "closed=true\n");
}

await main();
