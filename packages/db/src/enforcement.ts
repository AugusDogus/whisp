import type { db } from "./client";

import { and, eq, gt, ne } from "drizzle-orm";

import { AbuseEnforcement, AccountSuspension, account } from "./schema";

type Database = Pick<typeof db, "select" | "insert">;
export type EnforcementConfig = {
  key: string | undefined;
  policyVersion: string | undefined;
};

async function digest(key: string, value: string) {
  const encoder = new TextEncoder();
  const imported = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    imported,
    encoder.encode(value),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export const Enforcement = {
  async identity(
    database: Database,
    config: EnforcementConfig,
    discordId: string,
    now = new Date(),
  ) {
    if (!config.key || config.key.length < 32)
      return { status: "unconfigured" } as const;
    const keyTag = await digest(config.key, "whisp:enforcement:key:v1");
    const [incompatible] = await database
      .select({ id: AbuseEnforcement.id })
      .from(AbuseEnforcement)
      .where(
        and(
          gt(AbuseEnforcement.expiresAt, now),
          ne(AbuseEnforcement.keyTag, keyTag),
        ),
      )
      .limit(1);
    if (incompatible) return { status: "key_mismatch" } as const;
    return {
      status: "ready",
      keyTag,
      fingerprint: await digest(
        config.key,
        `whisp:discord:enforcement:v1:${discordId}`,
      ),
    } as const;
  },

  // Runs before every session is issued, including the OAuth proxy callback.
  // Matching does not create fingerprints for ordinary users or renew decisions.
  async apply(database: typeof db, config: EnforcementConfig, userId: string) {
    return database.transaction(async (tx) => {
      const now = new Date();
      const [active] = await tx
        .select({ id: AbuseEnforcement.id })
        .from(AbuseEnforcement)
        .where(gt(AbuseEnforcement.expiresAt, now))
        .limit(1);
      if (!active) return { status: "ready" } as const;
      const accounts = await tx
        .select({ discordId: account.accountId })
        .from(account)
        .where(
          and(eq(account.userId, userId), eq(account.providerId, "discord")),
        );
      if (accounts.length === 0) return { status: "missing_identity" } as const;
      for (const linked of accounts) {
        const identity = await Enforcement.identity(
          tx,
          config,
          linked.discordId,
          now,
        );
        if (identity.status !== "ready") return identity;
        const [decision] = await tx
          .select()
          .from(AbuseEnforcement)
          .where(
            and(
              eq(AbuseEnforcement.fingerprint, identity.fingerprint),
              gt(AbuseEnforcement.expiresAt, now),
            ),
          );
        if (!decision) continue;
        await tx
          .insert(AccountSuspension)
          .values({
            userId,
            enforcementId: decision.id,
            expiresAt: decision.expiresAt,
          })
          .onConflictDoUpdate({
            target: AccountSuspension.userId,
            set: { enforcementId: decision.id, expiresAt: decision.expiresAt },
          });
      }
      return { status: "ready" } as const;
    });
  },
} as const;
