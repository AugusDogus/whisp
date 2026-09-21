import { and, eq, inArray } from "@acme/db";
import type { db } from "@acme/db/client";
import { GroupMember, user } from "@acme/db/schema";

import { Blocking } from "./blocking";
import { ContentAccess } from "./content-access";
import { getFriendIds } from "./friendship";

export const MessageRecipients = {
  // Called before issuing upload credentials and again inside the delivery
  // transaction: a block, suspension, or group departure can happen mid-upload.
  async resolve(
    database: Pick<typeof db, "select">,
    senderId: string,
    input: { groupId?: string; recipients?: string[] },
  ) {
    const access = await ContentAccess.status(database, senderId);
    if (access.status !== "allowed") return { status: "restricted" } as const;
    const directIds = [...new Set(input.recipients ?? [])];
    if (Boolean(input.groupId) === directIds.length > 0)
      return { status: "invalid" } as const;

    let candidates: string[];
    if (input.groupId) {
      const members = await database
        .select({ id: GroupMember.userId })
        .from(GroupMember)
        .where(eq(GroupMember.groupId, input.groupId));
      if (!members.some((member) => member.id === senderId))
        return { status: "unavailable" } as const;
      candidates = members
        .map((member) => member.id)
        .filter((id) => id !== senderId);
    } else {
      const friends = new Set(await getFriendIds(database, senderId));
      if (directIds.some((id) => id !== senderId && !friends.has(id)))
        return { status: "unavailable" } as const;
      candidates = directIds;
    }

    if (candidates.length === 0) return { status: "unavailable" } as const;
    const recipients = await database
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          inArray(user.id, candidates),
          Blocking.allowed(senderId, user.id),
          ContentAccess.notSuspended(user.id),
        ),
      );
    const recipientIds = recipients.map((recipient) => recipient.id);
    if (
      recipientIds.length === 0 ||
      (!input.groupId && recipientIds.length !== candidates.length)
    )
      return { status: "unavailable" } as const;
    return { status: "ready", recipientIds } as const;
  },
};
