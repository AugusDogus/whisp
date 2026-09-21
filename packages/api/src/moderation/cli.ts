// Operator-only CLI. There is deliberately no client-accessible moderation API.
import { asc } from "drizzle-orm";
import { z } from "zod/v4";

import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { AbuseReport, AccountSuspension } from "@acme/db/schema";

import { Moderation } from "../services/moderation";

const args = z
  .union([
    z.tuple([z.literal("list")]),
    z.tuple([z.literal("show"), z.string().min(1)]),
    z.tuple([
      z.literal("resolve"),
      z.string().min(1),
      z.enum(["dismiss", "suspend"]),
    ]),
    z.tuple([z.literal("restore"), z.string().min(1)]),
  ])
  .safeParse(process.argv.slice(2));

if (!args.success) {
  console.error(
    "Usage: cli.ts list | show REPORT_ID | resolve REPORT_ID dismiss|suspend | restore USER_ID",
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
      // JSON escaping keeps untrusted report text from becoming terminal controls.
      console.log(
        JSON.stringify(report ?? { error: "Report not found" }, null, 2),
      );
      if (!report) process.exitCode = 1;
      break;
    }
    case "resolve": {
      const result = await Moderation.resolve(db, command[1], command[2]);
      console.log(JSON.stringify(result));
      if (result.status !== "resolved") process.exitCode = 1;
      break;
    }
    case "restore":
      await db
        .delete(AccountSuspension)
        .where(eq(AccountSuspension.userId, command[1]));
      console.log(
        "Sharing suspension removed. Existing user blocks are unchanged.",
      );
      break;
  }
}
