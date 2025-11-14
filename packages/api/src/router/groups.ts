import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { and, eq, inArray, or } from "@acme/db";
import {
  Friendship,
  Group,
  GroupMembership,
  user as User,
} from "@acme/db/schema";

import { protectedProcedure } from "../trpc";

export const groupsRouter = {
  // Create a new group with selected friends
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(64),
        memberIds: z.array(z.string()).min(1).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;

      // Verify all members are friends with the creator
      const friendships = await ctx.db
        .select()
        .from(Friendship)
        .where(
          or(
            and(
              eq(Friendship.userIdA, me),
              inArray(Friendship.userIdB, input.memberIds),
            ),
            and(
              eq(Friendship.userIdB, me),
              inArray(Friendship.userIdA, input.memberIds),
            ),
          ),
        );

      const friendIds = new Set(
        friendships.map((f) => (f.userIdA === me ? f.userIdB : f.userIdA)),
      );

      // Only add members who are friends
      const validMemberIds = input.memberIds.filter((id) => friendIds.has(id));

      // Create the group
      const [group] = await ctx.db
        .insert(Group)
        .values({
          name: input.name,
          createdBy: me,
        })
        .returning();

      if (!group) {
        throw new Error("Failed to create group");
      }

      // Add all members including creator
      const memberships = [
        { groupId: group.id, userId: me },
        ...validMemberIds.map((userId) => ({
          groupId: group.id,
          userId,
        })),
      ];

      await ctx.db.insert(GroupMembership).values(memberships);

      return { groupId: group.id, name: group.name };
    }),

  // List all groups the user is a member of
  list: protectedProcedure.query(async ({ ctx }) => {
    const me = ctx.session.user.id;

    // Get all groups where user is a member
    const memberships = await ctx.db
      .select()
      .from(GroupMembership)
      .where(eq(GroupMembership.userId, me));

    if (memberships.length === 0) {
      return [];
    }

    const groupIds = memberships.map((m) => m.groupId);

    // Get group details
    const groups = await ctx.db
      .select()
      .from(Group)
      .where(inArray(Group.id, groupIds));

    // Get all memberships for these groups
    const allMemberships = await ctx.db
      .select()
      .from(GroupMembership)
      .where(inArray(GroupMembership.groupId, groupIds));

    // Get user details for all members
    const allUserIds = [...new Set(allMemberships.map((m) => m.userId))];
    const users = await ctx.db
      .select()
      .from(User)
      .where(inArray(User.id, allUserIds));

    const userMap = new Map(users.map((u) => [u.id, u]));

    // Build group list with member details
    return groups.map((group) => {
      const groupMembers = allMemberships
        .filter((m) => m.groupId === group.id)
        .map((m) => {
          const user = userMap.get(m.userId);
          return user
            ? {
                id: user.id,
                name: user.name,
                image: user.image ?? null,
              }
            : null;
        })
        .filter(Boolean);

      return {
        id: group.id,
        name: group.name,
        createdBy: group.createdBy,
        createdAt: group.createdAt,
        members: groupMembers,
        memberCount: groupMembers.length,
      };
    });
  }),

  // Get details of a specific group
  get: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const me = ctx.session.user.id;

      // Verify user is a member
      const membership = await ctx.db
        .select()
        .from(GroupMembership)
        .where(
          and(
            eq(GroupMembership.groupId, input.groupId),
            eq(GroupMembership.userId, me),
          ),
        )
        .limit(1);

      if (membership.length === 0) {
        throw new Error("Not a member of this group");
      }

      // Get group details
      const [group] = await ctx.db
        .select()
        .from(Group)
        .where(eq(Group.id, input.groupId));

      if (!group) {
        throw new Error("Group not found");
      }

      // Get all members
      const memberships = await ctx.db
        .select()
        .from(GroupMembership)
        .where(eq(GroupMembership.groupId, input.groupId));

      const memberIds = memberships.map((m) => m.userId);
      const users = await ctx.db
        .select()
        .from(User)
        .where(inArray(User.id, memberIds));

      return {
        id: group.id,
        name: group.name,
        createdBy: group.createdBy,
        createdAt: group.createdAt,
        members: users.map((u) => ({
          id: u.id,
          name: u.name,
          image: u.image ?? null,
        })),
      };
    }),

  // Add a friend to the group
  addMember: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;

      // Verify user is a member of the group
      const membership = await ctx.db
        .select()
        .from(GroupMembership)
        .where(
          and(
            eq(GroupMembership.groupId, input.groupId),
            eq(GroupMembership.userId, me),
          ),
        )
        .limit(1);

      if (membership.length === 0) {
        throw new Error("Not a member of this group");
      }

      // Verify the user to add is a friend
      const friendship = await ctx.db
        .select()
        .from(Friendship)
        .where(
          or(
            and(
              eq(Friendship.userIdA, me),
              eq(Friendship.userIdB, input.userId),
            ),
            and(
              eq(Friendship.userIdB, me),
              eq(Friendship.userIdA, input.userId),
            ),
          ),
        )
        .limit(1);

      if (friendship.length === 0) {
        throw new Error("Can only add friends to groups");
      }

      // Check if user is already a member
      const existingMembership = await ctx.db
        .select()
        .from(GroupMembership)
        .where(
          and(
            eq(GroupMembership.groupId, input.groupId),
            eq(GroupMembership.userId, input.userId),
          ),
        )
        .limit(1);

      if (existingMembership.length > 0) {
        return { ok: true, alreadyMember: true };
      }

      // Add the member
      await ctx.db.insert(GroupMembership).values({
        groupId: input.groupId,
        userId: input.userId,
      });

      return { ok: true, alreadyMember: false };
    }),

  // Remove a member from the group (only group creator can do this)
  removeMember: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;

      // Get group details
      const [group] = await ctx.db
        .select()
        .from(Group)
        .where(eq(Group.id, input.groupId));

      if (!group) {
        throw new Error("Group not found");
      }

      // Only creator can remove members
      if (group.createdBy !== me) {
        throw new Error("Only group creator can remove members");
      }

      // Cannot remove yourself (use leave instead)
      if (input.userId === me) {
        throw new Error("Use leave endpoint to remove yourself");
      }

      // Remove the member
      await ctx.db
        .delete(GroupMembership)
        .where(
          and(
            eq(GroupMembership.groupId, input.groupId),
            eq(GroupMembership.userId, input.userId),
          ),
        );

      return { ok: true };
    }),

  // Leave a group
  leave: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;

      // Remove the user from the group
      await ctx.db
        .delete(GroupMembership)
        .where(
          and(
            eq(GroupMembership.groupId, input.groupId),
            eq(GroupMembership.userId, me),
          ),
        );

      // If the group has no members left, delete the group
      const remainingMembers = await ctx.db
        .select()
        .from(GroupMembership)
        .where(eq(GroupMembership.groupId, input.groupId))
        .limit(1);

      if (remainingMembers.length === 0) {
        await ctx.db.delete(Group).where(eq(Group.id, input.groupId));
      }

      return { ok: true };
    }),

  // Update group name (only creator can do this)
  updateName: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        name: z.string().min(1).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;

      // Get group details
      const [group] = await ctx.db
        .select()
        .from(Group)
        .where(eq(Group.id, input.groupId));

      if (!group) {
        throw new Error("Group not found");
      }

      // Only creator can update the name
      if (group.createdBy !== me) {
        throw new Error("Only group creator can update the name");
      }

      // Update the name
      await ctx.db
        .update(Group)
        .set({ name: input.name })
        .where(eq(Group.id, input.groupId));

      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
