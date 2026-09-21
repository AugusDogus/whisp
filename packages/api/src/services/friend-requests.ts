import { and, eq, or } from "@acme/db";
import type { db } from "@acme/db/client";
import { FriendRequest, Friendship } from "@acme/db/schema";

import { Blocking } from "./blocking";
import { ContentAccess } from "./content-access";

type Database = Pick<typeof db, "select" | "insert" | "delete">;

// Call inside a transaction so a concurrent block cannot resurrect a friendship.
export const FriendRequests = {
  async send(database: Database, senderId: string, recipientId: string) {
    if (
      senderId === recipientId ||
      (await ContentAccess.status(database, senderId)).status !== "allowed" ||
      !(await Blocking.canContact(database, senderId, recipientId))
    )
      return { status: "unavailable" } as const;
    const [friend] = await database
      .select({ id: Friendship.id })
      .from(Friendship)
      .where(
        or(
          and(
            eq(Friendship.userIdA, senderId),
            eq(Friendship.userIdB, recipientId),
          ),
          and(
            eq(Friendship.userIdA, recipientId),
            eq(Friendship.userIdB, senderId),
          ),
        ),
      );
    if (friend) return { status: "existing" } as const;
    const [existing] = await database
      .select({ id: FriendRequest.id })
      .from(FriendRequest)
      .where(
        and(
          eq(FriendRequest.fromUserId, senderId),
          eq(FriendRequest.toUserId, recipientId),
          eq(FriendRequest.status, "pending"),
        ),
      );
    if (existing) return { status: "existing" } as const;
    const requestId = crypto.randomUUID();
    await database.insert(FriendRequest).values({
      id: requestId,
      fromUserId: senderId,
      toUserId: recipientId,
      status: "pending",
    });
    return { status: "requested", requestId } as const;
  },

  async accept(database: Database, recipientId: string, requestId: string) {
    const [request] = await database
      .select()
      .from(FriendRequest)
      .where(
        and(
          eq(FriendRequest.id, requestId),
          eq(FriendRequest.toUserId, recipientId),
          eq(FriendRequest.status, "pending"),
        ),
      );
    if (
      !request ||
      (await ContentAccess.status(database, recipientId)).status !==
        "allowed" ||
      !(await Blocking.canContact(database, recipientId, request.fromUserId))
    )
      return { status: "unavailable" } as const;
    const userIdA =
      request.fromUserId < recipientId ? request.fromUserId : recipientId;
    const userIdB =
      request.fromUserId < recipientId ? recipientId : request.fromUserId;
    const [existing] = await database
      .select({ id: Friendship.id })
      .from(Friendship)
      .where(
        and(eq(Friendship.userIdA, userIdA), eq(Friendship.userIdB, userIdB)),
      );
    if (!existing)
      await database.insert(Friendship).values({ userIdA, userIdB });
    await database.delete(FriendRequest).where(eq(FriendRequest.id, requestId));
    return { status: "accepted", senderId: request.fromUserId } as const;
  },
};
