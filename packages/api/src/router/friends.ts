import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { and, eq, inArray, ne, or, sql } from "@acme/db";
import { FriendRequest, Friendship, user as User } from "@acme/db/schema";

import { FRIEND_REQUEST_STATUS } from "../constants";
import { Blocking } from "../services/blocking";
import { ContentAccess } from "../services/content-access";
import { FriendRequests } from "../services/friend-requests";
import { getFriendsWithDiscordIds } from "../services/member";
import {
  deriveLastSentOpened,
  getLastReceivedMimeTypes,
  getLastSentMimeTypes,
  getPendingSentDeliveries,
} from "../services/message-status";
import { protectedProcedure, sharingProcedure } from "../trpc";
import {
  notifyFriendAccept,
  notifyFriendRequest,
} from "../utils/send-notification";
import { deriveDisplayedStreakState } from "../utils/streak-state";

export const friendsRouter = {
  searchUsers: protectedProcedure
    .input(z.object({ query: z.string().trim().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const me = ctx.session.user.id;
      // Discord display names can differ from usernames and are not unique.
      const users = await ctx.db
        .select()
        .from(User)
        .where(
          and(
            sql`lower(${User.discordUsername}) = lower(${input.query})`,
            ne(User.id, me),
            Blocking.allowed(me, User.id),
            ContentAccess.notSuspended(User.id),
          ),
        );

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
              r.status === FRIEND_REQUEST_STATUS.PENDING) ||
            (r.toUserId === me &&
              r.fromUserId === u.id &&
              r.status === FRIEND_REQUEST_STATUS.PENDING),
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
      .where(
        and(
          or(eq(Friendship.userIdA, me), eq(Friendship.userIdB, me)),
          Blocking.allowed(Friendship.userIdA, Friendship.userIdB),
        ),
      );

    const friendIds = rows.map((r) =>
      r.userIdA === me ? r.userIdB : r.userIdA,
    );

    // Feature flag: Allow sending messages to yourself for testing
    const allowSelfMessages = process.env.ALLOW_SELF_MESSAGES === "true";
    if (allowSelfMessages) {
      friendIds.push(me);
    }

    if (friendIds.length === 0) return [];

    const friends = await getFriendsWithDiscordIds(ctx.db, friendIds);
    const now = new Date();

    const friendshipMap = new Map(
      rows.map((r) => {
        const isUserA = r.userIdA === me;
        const friendId = isUserA ? r.userIdB : r.userIdA;
        const myLastActivity = isUserA
          ? r.lastActivityTimestampA
          : r.lastActivityTimestampB;
        const partnerLastActivity = isUserA
          ? r.lastActivityTimestampB
          : r.lastActivityTimestampA;
        const streakState = deriveDisplayedStreakState({
          currentStreak: r.currentStreak,
          streakUpdatedAt: r.streakUpdatedAt,
          myLastActivity,
          partnerLastActivity,
          now,
        });

        return [
          friendId,
          {
            streak: streakState.streak,
            shouldShowStreak: streakState.shouldShowStreak,
            bothSentToday: streakState.bothSentToday,
            isStreakAtRisk: streakState.isStreakAtRisk,
            streakDayEndsAt: streakState.streakDayEndsAt,
            myLastActivity,
            partnerLastActivity,
          },
        ];
      }),
    );

    const friendIdsWhereSentLast = friendIds.filter((fid) => {
      const info = friendshipMap.get(fid);
      if (!info?.myLastActivity) return false;
      return (
        !info.partnerLastActivity ||
        info.myLastActivity > info.partnerLastActivity
      );
    });

    const friendIdsWhereReceivedLast = friendIds.filter(
      (fid) => !friendIdsWhereSentLast.includes(fid),
    );

    const [hasPendingSentTo, lastSentMimeMap, lastReceivedMimeMap] =
      await Promise.all([
        getPendingSentDeliveries(ctx.db, me, friendIdsWhereSentLast),
        getLastSentMimeTypes(ctx.db, me, friendIdsWhereSentLast),
        getLastReceivedMimeTypes(ctx.db, me, friendIdsWhereReceivedLast),
      ]);

    return friends.map((u) => {
      const streakInfo = friendshipMap.get(u.id);
      const lastSentOpened = deriveLastSentOpened(
        u.id,
        friendIdsWhereSentLast,
        hasPendingSentTo,
      );
      const lastMimeType = friendIdsWhereSentLast.includes(u.id)
        ? (lastSentMimeMap.get(u.id) ?? null)
        : (lastReceivedMimeMap.get(u.id) ?? null);

      return {
        id: u.id,
        name: u.name,
        image: u.image ?? null,
        discordId: u.discordId ?? null,
        discordProfile: u.discordProfile,
        streak: streakInfo?.streak ?? 0,
        shouldShowStreak: streakInfo?.shouldShowStreak ?? false,
        bothSentToday: streakInfo?.bothSentToday ?? false,
        isStreakAtRisk: streakInfo?.isStreakAtRisk ?? false,
        streakDayEndsAt: streakInfo?.streakDayEndsAt ?? null,
        lastActivityTimestamp: streakInfo?.myLastActivity ?? null,
        partnerLastActivityTimestamp: streakInfo?.partnerLastActivity ?? null,
        lastSentOpened,
        lastMimeType,
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
          eq(FriendRequest.status, FRIEND_REQUEST_STATUS.PENDING),
          Blocking.allowed(me, FriendRequest.fromUserId),
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

  sendRequest: sharingProcedure
    .input(z.object({ toUserId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.transaction((tx) =>
        FriendRequests.send(tx, ctx.session.user.id, input.toUserId),
      );
      if (result.status === "unavailable")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This account is unavailable for friend requests.",
        });
      if (result.status === "requested")
        void notifyFriendRequest(
          ctx.db,
          input.toUserId,
          ctx.session.user.name,
          result.requestId,
        );
      return { ok: true };
    }),

  acceptRequest: sharingProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.transaction((tx) =>
        FriendRequests.accept(tx, ctx.session.user.id, input.requestId),
      );
      if (result.status === "unavailable")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This friend request is no longer available.",
        });
      void notifyFriendAccept(
        ctx.db,
        result.senderId,
        ctx.session.user.name,
        ctx.session.user.id,
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
      if (
        request?.toUserId !== me ||
        request.status !== FRIEND_REQUEST_STATUS.PENDING
      )
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
