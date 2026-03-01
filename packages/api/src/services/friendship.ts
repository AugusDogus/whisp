import { and, eq, or } from "@acme/db";
import type { db } from "@acme/db/client";
import { Friendship } from "@acme/db/schema";

export async function getFriendIds(
  dbClient: typeof db,
  userId: string,
): Promise<string[]> {
  const rows = await dbClient
    .select()
    .from(Friendship)
    .where(or(eq(Friendship.userIdA, userId), eq(Friendship.userIdB, userId)));
  return rows.map((r) => (r.userIdA === userId ? r.userIdB : r.userIdA));
}

export async function checkIsFriend(
  dbClient: typeof db,
  userIdA: string,
  userIdB: string,
): Promise<boolean> {
  const [row] = await dbClient
    .select()
    .from(Friendship)
    .where(
      or(
        and(eq(Friendship.userIdA, userIdA), eq(Friendship.userIdB, userIdB)),
        and(eq(Friendship.userIdA, userIdB), eq(Friendship.userIdB, userIdA)),
      ),
    )
    .limit(1);
  return !!row;
}
