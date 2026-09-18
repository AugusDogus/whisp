/**
 * Run with DATABASE_URL, DATABASE_TOKEN, and DISCORD_BOT_TOKEN configured.
 * Dry-run by default. Pass --apply before deploying the username-search change.
 * Adds the nullable username column and backfills existing users atomically.
 */
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import { z } from "zod/v4";

import { eq, sql } from "@acme/db";
import { db } from "@acme/db/client";
import { account, user } from "@acme/db/schema";

import { DISCORD_PROVIDER_ID } from "../constants";

const discordProfile = z.object({
  id: z.string(),
  username: z.string().min(1),
});

async function backfillDiscordUsernames() {
  const token = z.string().min(1).parse(process.env.DISCORD_BOT_TOKEN);
  const rest = new REST({ version: "10" }).setToken(token);
  const columns = z
    .array(z.object({ name: z.string() }))
    .parse(await db.all(sql`PRAGMA table_info("user")`));
  const needsColumn = !columns.some(
    (column) => column.name === "discordUsername",
  );
  const accounts = await db
    .select({ userId: user.id, discordId: account.accountId })
    .from(account)
    .innerJoin(user, eq(user.id, account.userId))
    .where(eq(account.providerId, DISCORD_PROVIDER_ID));

  // Resolve every username before changing the database. Discord failures leave it intact.
  const updates: { userId: string; username: string }[] = [];
  for (const linkedAccount of accounts) {
    const profile = discordProfile.parse(
      await rest.get(Routes.user(linkedAccount.discordId)),
    );
    if (profile.id !== linkedAccount.discordId) {
      throw new Error(
        `Discord returned a different account for ${linkedAccount.discordId}. No changes applied.`,
      );
    }
    updates.push({ userId: linkedAccount.userId, username: profile.username });
  }

  if (!process.argv.includes("--apply")) {
    console.log(
      `Dry run: ${needsColumn ? "add discordUsername and " : ""}update ${updates.length} Discord usernames. No database changes made.`,
    );
    return;
  }

  await db.transaction(async (tx) => {
    if (needsColumn) {
      await tx.run(sql`ALTER TABLE "user" ADD COLUMN "discordUsername" text`);
    }
    for (const update of updates) {
      const updated = await tx
        .update(user)
        .set({ discordUsername: update.username })
        .where(eq(user.id, update.userId))
        .returning({ id: user.id });
      if (updated.length !== 1) {
        throw new Error(
          `User ${update.userId} changed during the backfill. Transaction rolled back; rerun the script.`,
        );
      }
    }
  });
  console.log(
    `Updated ${updates.length} Discord usernames. Display names and friendships are unchanged.`,
  );
}

await backfillDiscordUsernames().catch((error: unknown) => {
  console.error(
    "Discord username backfill failed. Database changes were not committed.",
  );
  console.error(
    error instanceof Error
      ? error.message
      : "Unknown error; check database and Discord connectivity before retrying.",
  );
  process.exitCode = 1;
});
