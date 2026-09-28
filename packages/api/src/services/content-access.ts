import { and, eq, sql } from "@acme/db";
import type { SQLWrapper } from "@acme/db";
import type { db } from "@acme/db/client";
import {
  AccountSuspension,
  ContentPolicyAcceptance,
  user,
} from "@acme/db/schema";
import { CONTENT_POLICY_VERSION } from "@acme/validators";

type Database = Pick<typeof db, "select">;

export const ContentAccess = {
  async status(database: Database, userId: string) {
    const [row] = await database
      .select({
        acceptedVersion: ContentPolicyAcceptance.version,
        suspendedUserId: AccountSuspension.userId,
      })
      .from(user)
      .leftJoin(
        ContentPolicyAcceptance,
        eq(ContentPolicyAcceptance.userId, user.id),
      )
      .leftJoin(
        AccountSuspension,
        and(
          eq(AccountSuspension.userId, user.id),
          sql`(${AccountSuspension.expiresAt} is null or ${AccountSuspension.expiresAt} > unixepoch())`,
        ),
      )
      .where(eq(user.id, userId));
    if (!row) return { status: "unavailable" } as const;
    if (row.suspendedUserId) return { status: "suspended" } as const;
    if (row.acceptedVersion !== CONTENT_POLICY_VERSION)
      return { status: "acceptance_required" } as const;
    return { status: "allowed" } as const;
  },

  // Correlated predicate for queries that already read the sender, so checking
  // sharing access does not add a round trip.
  sharingAllowed(userId: string | SQLWrapper) {
    return sql`(exists (select 1 from ${ContentPolicyAcceptance} where ${ContentPolicyAcceptance.userId} = ${userId} and ${ContentPolicyAcceptance.version} = ${CONTENT_POLICY_VERSION}) and ${ContentAccess.notSuspended(userId)})`;
  },

  // Correlated predicate used again when reading deliveries and sending pushes.
  notSuspended(userId: string | SQLWrapper) {
    return sql`not exists (select 1 from ${AccountSuspension} where ${AccountSuspension.userId} = ${userId} and (${AccountSuspension.expiresAt} is null or ${AccountSuspension.expiresAt} > unixepoch()))`;
  },
};
