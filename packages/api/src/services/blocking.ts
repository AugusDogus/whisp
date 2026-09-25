import { and, eq, or, sql } from "@acme/db";
import type { SQLWrapper } from "@acme/db";
import type { db } from "@acme/db/client";
import {
  FriendRequest,
  Friendship,
  Message,
  MessageDelivery,
  UserBlock,
  user,
} from "@acme/db/schema";

import { ContentAccess } from "./content-access";

type Database = Pick<typeof db, "select" | "insert" | "delete">;

export const Blocking = {
  // Either user's block prevents contact. Never disclose who set it to the other user.
  allowed(first: string | SQLWrapper, second: string | SQLWrapper) {
    return sql`not exists (select 1 from ${UserBlock} where
      (${UserBlock.blockerId} = ${first} and ${UserBlock.blockedId} = ${second}) or
      (${UserBlock.blockerId} = ${second} and ${UserBlock.blockedId} = ${first}))`;
  },

  async canContact(
    database: Pick<typeof db, "select">,
    first: string,
    second: string,
  ) {
    const [target] = await database
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          eq(user.id, second),
          Blocking.allowed(first, second),
          ContentAccess.notSuspended(first),
          ContentAccess.notSuspended(second),
        ),
      );
    return target !== undefined;
  },

  // The caller runs this in a transaction, so removing the block cannot restore
  // an old friendship or a pending request.
  async block(database: Database, blockerId: string, blockedId: string) {
    if (blockerId === blockedId) return { status: "self" } as const;
    const [target] = await database
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, blockedId));
    if (!target) return { status: "missing" } as const;
    await database
      .insert(UserBlock)
      .values({ blockerId, blockedId })
      .onConflictDoNothing();
    await database
      .delete(Friendship)
      .where(
        or(
          and(
            eq(Friendship.userIdA, blockerId),
            eq(Friendship.userIdB, blockedId),
          ),
          and(
            eq(Friendship.userIdA, blockedId),
            eq(Friendship.userIdB, blockerId),
          ),
        ),
      );
    await database
      .delete(FriendRequest)
      .where(
        or(
          and(
            eq(FriendRequest.fromUserId, blockerId),
            eq(FriendRequest.toUserId, blockedId),
          ),
          and(
            eq(FriendRequest.fromUserId, blockedId),
            eq(FriendRequest.toUserId, blockerId),
          ),
        ),
      );
    await database
      .delete(MessageDelivery)
      .where(
        or(
          and(
            eq(MessageDelivery.recipientId, blockerId),
            sql`${MessageDelivery.messageId} in (select ${Message.id} from ${Message} where ${Message.senderId} = ${blockedId})`,
          ),
          and(
            eq(MessageDelivery.recipientId, blockedId),
            sql`${MessageDelivery.messageId} in (select ${Message.id} from ${Message} where ${Message.senderId} = ${blockerId})`,
          ),
        ),
      );
    return { status: "blocked" } as const;
  },
};
