// Operator-only CLI. There is deliberately no client-accessible moderation API.
// Run with the target environment's DATABASE_URL and DATABASE_TOKEN, plus its
// enforcement key file (production and preview use separate keys):
//   bun --env-file ~/.config/whisp/enforcement-production.env packages/api/src/moderation/cli.ts list
// Output is JSON; report text is escaped so it cannot act as terminal input.
// `enforce` keeps a hashed identity after account deletion. Its final argument
// attests that a human confirmed serious abuse and that a shorter period is not
// enough; never infer that from the report category alone.
import { asc, gt } from "drizzle-orm";
import { z } from "zod/v4";

import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Enforcement } from "@acme/db/enforcement";
import { AbuseEnforcement, AbuseReport } from "@acme/db/schema";

import { Moderation } from "../services/moderation";

const args = z
  .union([
    z.tuple([z.literal("list")]),
    z.tuple([z.literal("lookup")]),
    z.tuple([z.literal("show"), z.string().min(1)]),
    z.tuple([z.literal("resolve"), z.string().min(1), z.literal("dismiss")]),
    z.tuple([
      z.literal("resolve"),
      z.string().min(1),
      z.literal("suspend"),
      z.string(),
    ]),
    z.tuple([
      z.literal("enforce"),
      z.string().min(1),
      z.string(),
      z.string(),
      z.literal("confirmed-necessary-proportionate"),
    ]),
    z.tuple([z.literal("restore"), z.string().min(1)]),
    z.tuple([z.literal("enforcements")]),
    z.tuple([z.literal("revoke"), z.string().min(1)]),
  ])
  .safeParse(process.argv.slice(2));

if (!args.success) {
  console.error(
    "Usage: cli.ts list | lookup (Discord ID on stdin) | show REPORT_ID | resolve REPORT_ID dismiss | resolve REPORT_ID suspend EXPIRY_ISO | enforce REPORT_ID REASON EXPIRY_ISO confirmed-necessary-proportionate | restore USER_ID | enforcements | revoke ENFORCEMENT_ID.",
  );
  process.exitCode = 1;
} else {
  const command = args.data;
  switch (command[0]) {
    case "list":
      console.log(
        JSON.stringify(
          await db
            .select({
              id: AbuseReport.id,
              reason: AbuseReport.reason,
              createdAt: AbuseReport.createdAt,
            })
            .from(AbuseReport)
            .where(eq(AbuseReport.status, "pending"))
            .orderBy(asc(AbuseReport.createdAt))
            .limit(100),
          null,
          2,
        ),
      );
      break;
    case "show": {
      const [report] = await db
        .select()
        .from(AbuseReport)
        .where(eq(AbuseReport.id, command[1]));
      // JSON escaping keeps untrusted text from becoming terminal controls.
      console.log(
        JSON.stringify(report ?? { error: "Report not found" }, null, 2),
      );
      if (!report) process.exitCode = 1;
      break;
    }
    case "resolve":
    case "enforce": {
      const decision =
        command[0] === "enforce"
          ? {
              action: "enforce",
              reason: command[2],
              expiresAt: command[3],
              confirmedSeriousAbuse: true,
              necessaryDespiteDeletion: true,
              shorterPeriodInsufficient: true,
              rightsAndAgeConsidered: true,
            }
          : { action: command[2], expiresAt: command[3] };
      const result = await Moderation.resolve(db, command[1], decision, {
        key: process.env.ABUSE_ENFORCEMENT_KEY,
        policyVersion: process.env.ABUSE_RETENTION_POLICY_VERSION,
      });
      console.log(JSON.stringify(result));
      if (result.status !== "resolved") process.exitCode = 1;
      break;
    }
    case "restore":
      await Moderation.restore(db, command[1]);
      console.log("Suspension and any linked enforcement removed.");
      break;
    case "lookup": {
      const input = z
        .string()
        .trim()
        .regex(/^[0-9]{17,20}$/)
        .safeParse(await Bun.stdin.text());
      if (!input.success) {
        console.error("Supply a Discord ID on standard input.");
        process.exitCode = 1;
        break;
      }
      const identity = await Enforcement.identity(
        db,
        {
          key: process.env.ABUSE_ENFORCEMENT_KEY,
          policyVersion: process.env.ABUSE_RETENTION_POLICY_VERSION,
        },
        input.data,
      );
      if (identity.status !== "ready") {
        console.error(JSON.stringify({ status: identity.status }));
        process.exitCode = 1;
        break;
      }
      const [decision] = await db
        .select({
          id: AbuseEnforcement.id,
          reason: AbuseEnforcement.reason,
          expiresAt: AbuseEnforcement.expiresAt,
        })
        .from(AbuseEnforcement)
        .where(eq(AbuseEnforcement.fingerprint, identity.fingerprint));
      console.log(JSON.stringify(decision ?? { status: "not_found" }));
      break;
    }
    case "enforcements":
      // Never print fingerprints or key tags. IDs support appeals after deletion.
      console.log(
        JSON.stringify(
          await db
            .select({
              id: AbuseEnforcement.id,
              reason: AbuseEnforcement.reason,
              policyVersion: AbuseEnforcement.policyVersion,
              decidedAt: AbuseEnforcement.decidedAt,
              expiresAt: AbuseEnforcement.expiresAt,
            })
            .from(AbuseEnforcement)
            .where(gt(AbuseEnforcement.expiresAt, new Date()))
            .orderBy(asc(AbuseEnforcement.expiresAt))
            .limit(100),
          null,
          2,
        ),
      );
      break;
    case "revoke":
      await db
        .delete(AbuseEnforcement)
        .where(eq(AbuseEnforcement.id, command[1]));
      console.log("Enforcement removed, including linked account suspensions.");
      break;
  }
}
