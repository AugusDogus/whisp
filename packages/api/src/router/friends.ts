import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { and, eq, inArray, like, ne, or } from "@acme/db";
import {
  account as Account,
  FriendRequest,
  Friendship,
  user as User,
} from "@acme/db/schema";

import { protectedProcedure } from "../trpc";
import {
  notifyFriendAccept,
  notifyFriendRequest,
} from "../utils/send-notification";

export const friendsRouter = {
  searchUsers: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const q = `%${input.query.trim()}%`;
      const me = ctx.session.user.id;
      // Simple search by name, excluding self
      const users = await ctx.db
        .select()
        .from(User)
        .where(and(like(User.name, q), ne(User.id, me)));

      // Determine friendship/request status for each user
      const userIds = users.map((u) => u.id);
      if (userIds.length === 0)
        return [] as {
          id: string;
          name: string;
          image: string | null;
          isFriend: boolean;
          hasPendingRequest: boolean;
        }[];

      const friendships = await ctx.db
        .select()
        .from(Friendship)
        .where(
          or(
            and(
              eq(Friendship.userIdA, me),
              inArray(Friendship.userIdB, userIds),
            ),
            and(
              eq(Friendship.userIdB, me),
              inArray(Friendship.userIdA, userIds),
            ),
          ),
        );

      const requests = await ctx.db
        .select()
        .from(FriendRequest)
        .where(
          or(
            and(
              eq(FriendRequest.fromUserId, me),
              inArray(FriendRequest.toUserId, userIds),
            ),
            and(
              eq(FriendRequest.toUserId, me),
              inArray(FriendRequest.fromUserId, userIds),
            ),
          ),
        );

      return users.map((u) => {
        const isFriend = friendships.some(
          (f) =>
            (f.userIdA === me && f.userIdB === u.id) ||
            (f.userIdB === me && f.userIdA === u.id),
        );
        const hasPendingRequest = requests.some(
          (r) =>
            (r.fromUserId === me &&
              r.toUserId === u.id &&
              r.status === "pending") ||
            (r.toUserId === me &&
              r.fromUserId === u.id &&
              r.status === "pending"),
        );
        return {
          id: u.id,
          name: u.name,
          image: u.image ?? null,
          isFriend,
          hasPendingRequest,
        };
      });
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const me = ctx.session.user.id;
    const rows = await ctx.db
      .select()
      .from(Friendship)
      .where(or(eq(Friendship.userIdA, me), eq(Friendship.userIdB, me)));

    const friendIds = rows.map((r) =>
      r.userIdA === me ? r.userIdB : r.userIdA,
    );

    // Feature flag: Allow sending messages to yourself for testing
    const allowSelfMessages = process.env.ALLOW_SELF_MESSAGES === "true";
    if (allowSelfMessages) {
      friendIds.push(me);
    }

    if (friendIds.length === 0)
      return [] as {
        id: string;
        name: string;
        image: string | null;
        discordId: string | null;
        streak: number;
        lastActivityTimestamp: Date | null;
        partnerLastActivityTimestamp: Date | null;
      }[];

    const friends = await ctx.db
      .select({
        id: User.id,
        name: User.name,
        image: User.image,
        discordId: Account.accountId,
      })
      .from(User)
      .leftJoin(
        Account,
        and(eq(Account.userId, User.id), eq(Account.providerId, "discord")),
      )
      .where(or(...friendIds.map((id) => eq(User.id, id))));

    // Create a map of friend ID to streak info
    const friendshipMap = new Map(
      rows.map((r) => {
        const isUserA = r.userIdA === me;
        const friendId = isUserA ? r.userIdB : r.userIdA;
        return [
          friendId,
          {
            streak: r.currentStreak,
            myLastActivity: isUserA
              ? r.lastActivityTimestampA
              : r.lastActivityTimestampB,
            partnerLastActivity: isUserA
              ? r.lastActivityTimestampB
              : r.lastActivityTimestampA,
          },
        ];
      }),
    );

    return friends.map((u) => {
      const streakInfo = friendshipMap.get(u.id);
      return {
        id: u.id,
        name: u.name,
        image: u.image ?? null,
        discordId: u.discordId ?? null,
        streak: streakInfo?.streak ?? 0,
        lastActivityTimestamp: streakInfo?.myLastActivity ?? null,
        partnerLastActivityTimestamp: streakInfo?.partnerLastActivity ?? null,
      };
    });
  }),

  incomingRequests: protectedProcedure.query(async ({ ctx }) => {
    const me = ctx.session.user.id;
    const pending = await ctx.db
      .select()
      .from(FriendRequest)
      .where(
        and(
          eq(FriendRequest.toUserId, me),
          eq(FriendRequest.status, "pending"),
        ),
      );

    const fromIds = pending.map((r) => r.fromUserId);
    const users = fromIds.length
      ? await ctx.db.select().from(User).where(inArray(User.id, fromIds))
      : ([] as (typeof User.$inferSelect)[]);
    const idToUser = new Map(users.map((u) => [u.id, u] as const));

    return pending
      .map((r) => {
        const u = idToUser.get(r.fromUserId);
        if (!u) return null;
        return { requestId: r.id, fromUser: { id: u.id, name: u.name } };
      })
      .filter(Boolean);
  }),

  sendRequest: protectedProcedure
    .input(z.object({ toUserId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;
      if (me === input.toUserId) return { ok: true };

      // If already friends, do nothing
      const existingFriend = await ctx.db
        .select()
        .from(Friendship)
        .where(
          or(
            and(
              eq(Friendship.userIdA, me),
              eq(Friendship.userIdB, input.toUserId),
            ),
            and(
              eq(Friendship.userIdB, me),
              eq(Friendship.userIdA, input.toUserId),
            ),
          ),
        );
      if (existingFriend.length > 0) return { ok: true };

      const [friendRequest] = await ctx.db
        .insert(FriendRequest)
        .values({
          fromUserId: me,
          toUserId: input.toUserId,
          status: "pending",
        })
        .returning();

      // Send notification (fire-and-forget, don't block response)
      if (friendRequest) {
        void notifyFriendRequest(
          ctx.db,
          input.toUserId,
          ctx.session.user.name,
          friendRequest.id,
        );
      }

      return { ok: true };
    }),

  acceptRequest: protectedProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;
      const request = (
        await ctx.db
          .select()
          .from(FriendRequest)
          .where(eq(FriendRequest.id, input.requestId))
      )[0];
      if (!request || request.toUserId !== me || request.status !== "pending")
        return { ok: false };

      // create friendship with normalized pair
      const a =
        request.fromUserId < request.toUserId
          ? request.fromUserId
          : request.toUserId;
      const b =
        request.fromUserId < request.toUserId
          ? request.toUserId
          : request.fromUserId;
      await ctx.db.insert(Friendship).values({ userIdA: a, userIdB: b });

      // Delete the friend request now that it's been accepted
      await ctx.db
        .delete(FriendRequest)
        .where(eq(FriendRequest.id, input.requestId));

      // Send notification to the person who sent the request (fire-and-forget)
      void notifyFriendAccept(
        ctx.db,
        request.fromUserId,
        ctx.session.user.name,
      );

      return { ok: true };
    }),

  declineRequest: protectedProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;
      const request = (
        await ctx.db
          .select()
          .from(FriendRequest)
          .where(eq(FriendRequest.id, input.requestId))
      )[0];
      if (!request || request.toUserId !== me || request.status !== "pending")
        return { ok: false };

      // Delete the friend request
      await ctx.db
        .delete(FriendRequest)
        .where(eq(FriendRequest.id, input.requestId));

      return { ok: true };
    }),

  removeFriend: protectedProcedure
    .input(z.object({ friendId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;
      if (me === input.friendId) return { ok: false };

      // Delete the friendship (handles both userIdA and userIdB cases)
      await ctx.db
        .delete(Friendship)
        .where(
          or(
            and(
              eq(Friendship.userIdA, me),
              eq(Friendship.userIdB, input.friendId),
            ),
            and(
              eq(Friendship.userIdB, me),
              eq(Friendship.userIdA, input.friendId),
            ),
          ),
        );

      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
