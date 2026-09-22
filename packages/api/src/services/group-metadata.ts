import { and, eq, sql } from "@acme/db";
import type { db } from "@acme/db/client";
import { Group, GroupMember } from "@acme/db/schema";

import { Blocking } from "./blocking";
import { ContentAccess } from "./content-access";

export const GroupMetadata = {
  async rename(
    database: typeof db,
    userId: string,
    input: { groupId: string; name: string },
  ) {
    return database.transaction(async (tx) => {
      if ((await ContentAccess.status(tx, userId)).status !== "allowed")
        return { status: "restricted" } as const;
      const [membership] = await tx
        .select({ id: GroupMember.id })
        .from(GroupMember)
        .where(
          and(
            eq(GroupMember.groupId, input.groupId),
            eq(GroupMember.userId, userId),
          ),
        );
      if (!membership) return { status: "unavailable" } as const;
      // A name is shared content visible to every member, unlike filtered media.
      const [blockedMember] = await tx
        .select({ id: GroupMember.id })
        .from(GroupMember)
        .where(
          and(
            eq(GroupMember.groupId, input.groupId),
            sql`not (${Blocking.allowed(userId, GroupMember.userId)})`,
          ),
        )
        .limit(1);
      if (blockedMember) return { status: "unavailable" } as const;
      await tx
        .update(Group)
        .set({ name: input.name })
        .where(eq(Group.id, input.groupId));
      return { status: "renamed" } as const;
    });
  },
} as const;
