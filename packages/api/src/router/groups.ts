import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, desc, eq, inArray, isNull } from "@acme/db";
import {
  Group,
  GroupMember,
  Message,
  MessageDelivery,
} from "@acme/db/schema";

import { getFriendIds } from "../services/friendship";
import {
  getGroupMemberAvatars,
  getGroupMembersWithDiscordIds,
} from "../services/member";
import { protectedProcedure } from "../trpc";

export const groupsRouter = {
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(64),
        memberIds: z.array(z.string().min(1)),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;

      const friendIds = await getFriendIds(ctx.db, me);
      const friendSet = new Set(friendIds);

      for (const mid of input.memberIds) {
        if (mid === me) continue;
        if (!friendSet.has(mid)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `User ${mid} is not a friend`,
          });
        }
      }

      const allMemberIds = [...new Set([me, ...input.memberIds])];

      const [group] = await ctx.db
        .insert(Group)
        .values({
          name: input.name.trim(),
          createdById: me,
        })
        .returning();

      if (!group)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create group",
        });

      await ctx.db.insert(GroupMember).values(
        allMemberIds.map((userId) => ({
          groupId: group.id,
          userId,
        })),
      );

      return { groupId: group.id };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const me = ctx.session.user.id;

    const memberships = await ctx.db
      .select()
      .from(GroupMember)
      .where(eq(GroupMember.userId, me));

    const groupIds = memberships.map((m) => m.groupId);
    if (groupIds.length === 0) {
      return [] as {
        id: string;
        name: string;
        memberCount: number;
        memberAvatars: { userId: string; image: string | null }[];
        lastMessageAt: Date | null;
        lastSentByMe: boolean;
        unreadCount: number;
      }[];
    }

    const [groups, groupToMembers] = await Promise.all([
      ctx.db.select().from(Group).where(inArray(Group.id, groupIds)),
      getGroupMemberAvatars(ctx.db, groupIds),
    ]);

    const groupToUnread = new Map<string, number>();
    const unreadDeliveries = await ctx.db
      .select({
        groupId: MessageDelivery.groupId,
      })
      .from(MessageDelivery)
      .where(
        and(
          eq(MessageDelivery.recipientId, me),
          isNull(MessageDelivery.readAt),
          inArray(MessageDelivery.groupId, groupIds),
        ),
      );

    for (const d of unreadDeliveries) {
      if (d.groupId) {
        groupToUnread.set(d.groupId, (groupToUnread.get(d.groupId) ?? 0) + 1);
      }
    }

    const lastMessages = await ctx.db
      .select({
        groupId: Message.groupId,
        createdAt: Message.createdAt,
      })
      .from(Message)
      .where(and(inArray(Message.groupId, groupIds), isNull(Message.deletedAt)))
      .orderBy(desc(Message.createdAt));

    const groupToLastAt = new Map<string, Date>();
    for (const m of lastMessages) {
      if (m.groupId && !groupToLastAt.has(m.groupId)) {
        groupToLastAt.set(m.groupId, m.createdAt);
      }
    }

    const lastSentMessages = await ctx.db
      .select({
        groupId: Message.groupId,
        senderId: Message.senderId,
      })
      .from(Message)
      .where(
        and(
          inArray(Message.groupId, groupIds),
          isNull(Message.deletedAt),
          eq(Message.senderId, me),
        ),
      )
      .orderBy(desc(Message.createdAt));

    const groupToLastSentAt = new Map<string, Date>();
    for (const m of lastSentMessages) {
      if (m.groupId && !groupToLastSentAt.has(m.groupId)) {
        groupToLastSentAt.set(
          m.groupId,
          groupToLastAt.get(m.groupId) ?? new Date(),
        );
      }
    }

    return groups.map((g) => {
      const members = groupToMembers.get(g.id) ?? [];
      const memberAvatars = members
        .slice(0, 4)
        .map((m) => ({ userId: m.userId, image: m.image }));

      return {
        id: g.id,
        name: g.name,
        memberCount: members.length,
        memberAvatars,
        lastMessageAt: groupToLastAt.get(g.id) ?? null,
        lastSentByMe: groupToLastSentAt.has(g.id),
        unreadCount: groupToUnread.get(g.id) ?? 0,
      };
    });
  }),

  get: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const me = ctx.session.user.id;

      const membership = (
        await ctx.db
          .select()
          .from(GroupMember)
          .where(
            and(
              eq(GroupMember.groupId, input.groupId),
              eq(GroupMember.userId, me),
            ),
          )
      )[0];

      if (!membership) return null;

      const group = (
        await ctx.db.select().from(Group).where(eq(Group.id, input.groupId))
      )[0];
      if (!group) return null;

      const members = await getGroupMembersWithDiscordIds(
        ctx.db,
        input.groupId,
      );

      return {
        id: group.id,
        name: group.name,
        createdById: group.createdById,
        members: members.map((m) => ({
          id: m.id,
          name: m.name,
          image: m.image ?? null,
          discordId: m.discordId ?? null,
        })),
      };
    }),

  addMembers: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        userIds: z.array(z.string().min(1)),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;

      const membership = (
        await ctx.db
          .select()
          .from(GroupMember)
          .where(
            and(
              eq(GroupMember.groupId, input.groupId),
              eq(GroupMember.userId, me),
            ),
          )
      )[0];
      if (!membership)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not a member of this group",
        });

      const friendIds = await getFriendIds(ctx.db, me);
      const friendSet = new Set(friendIds);

      const existing = await ctx.db
        .select({ userId: GroupMember.userId })
        .from(GroupMember)
        .where(eq(GroupMember.groupId, input.groupId));
      const existingSet = new Set(existing.map((e) => e.userId));

      const toAdd: string[] = [];
      for (const uid of input.userIds) {
        if (uid === me) continue;
        if (!friendSet.has(uid))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `User ${uid} is not a friend`,
          });
        if (!existingSet.has(uid)) toAdd.push(uid);
      }

      if (toAdd.length > 0) {
        await ctx.db.insert(GroupMember).values(
          toAdd.map((userId) => ({
            groupId: input.groupId,
            userId,
          })),
        );
      }

      return { ok: true };
    }),

  leave: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;

      await ctx.db
        .delete(GroupMember)
        .where(
          and(
            eq(GroupMember.groupId, input.groupId),
            eq(GroupMember.userId, me),
          ),
        );

      const remaining = await ctx.db
        .select()
        .from(GroupMember)
        .where(eq(GroupMember.groupId, input.groupId));

      if (remaining.length === 0) {
        await ctx.db.delete(Group).where(eq(Group.id, input.groupId));
      }

      return { ok: true };
    }),

  rename: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        name: z.string().min(1).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;

      const membership = (
        await ctx.db
          .select()
          .from(GroupMember)
          .where(
            and(
              eq(GroupMember.groupId, input.groupId),
              eq(GroupMember.userId, me),
            ),
          )
      )[0];
      if (!membership)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not a member of this group",
        });

      await ctx.db
        .update(Group)
        .set({ name: input.name.trim() })
        .where(eq(Group.id, input.groupId));

      return { ok: true };
    }),

  inbox: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const me = ctx.session.user.id;

      const membership = (
        await ctx.db
          .select()
          .from(GroupMember)
          .where(
            and(
              eq(GroupMember.groupId, input.groupId),
              eq(GroupMember.userId, me),
            ),
          )
      )[0];
      if (!membership)
        return [] as {
          deliveryId: string;
          messageId: string;
          senderId: string;
          fileUrl: string;
          mimeType?: string;
          thumbhash?: string;
          createdAt: Date;
        }[];

      const deliveries = await ctx.db
        .select()
        .from(MessageDelivery)
        .where(
          and(
            eq(MessageDelivery.recipientId, me),
            eq(MessageDelivery.groupId, input.groupId),
            isNull(MessageDelivery.readAt),
          ),
        );

      const messageIds = deliveries.map((d) => d.messageId);
      const messages =
        messageIds.length > 0
          ? await ctx.db
              .select()
              .from(Message)
              .where(inArray(Message.id, messageIds))
          : ([] as (typeof Message.$inferSelect)[]);
      const idToMessage = new Map(messages.map((m) => [m.id, m] as const));

      return deliveries
        .map((d) => {
          const m = idToMessage.get(d.messageId);
          if (!m) return null;
          return {
            deliveryId: d.id,
            messageId: d.messageId,
            senderId: m.senderId,
            fileUrl: m.fileUrl,
            mimeType: m.mimeType ?? undefined,
            thumbhash: m.thumbhash ?? undefined,
            createdAt: m.createdAt,
          };
        })
        .filter(Boolean) as {
        deliveryId: string;
        messageId: string;
        senderId: string;
        fileUrl: string;
        mimeType?: string;
        thumbhash?: string;
        createdAt: Date;
      }[];
    }),
} satisfies TRPCRouterRecord;
