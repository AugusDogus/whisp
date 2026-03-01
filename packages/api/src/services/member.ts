import { and, eq, inArray } from "@acme/db";
import type { db } from "@acme/db/client";
import { account as Account, GroupMember, user as User } from "@acme/db/schema";

import { DISCORD_PROVIDER_ID } from "../constants";

/**
 * Fetch group members with their user image (for avatar display in group lists).
 * Returns a map of groupId -> array of { userId, image }.
 */
export async function getGroupMemberAvatars(
  dbClient: typeof db,
  groupIds: string[],
): Promise<Map<string, { userId: string; image: string | null }[]>> {
  const result = new Map<string, { userId: string; image: string | null }[]>();
  if (groupIds.length === 0) return result;

  const allMembers = await dbClient
    .select({
      groupId: GroupMember.groupId,
      userId: GroupMember.userId,
      image: User.image,
    })
    .from(GroupMember)
    .innerJoin(User, eq(User.id, GroupMember.userId))
    .where(inArray(GroupMember.groupId, groupIds));

  for (const m of allMembers) {
    const existing = result.get(m.groupId) ?? [];
    existing.push({ userId: m.userId, image: m.image });
    result.set(m.groupId, existing);
  }

  return result;
}

/**
 * Fetch friends with their Discord account ID for avatar resolution.
 * Used by friends.list to display discord avatars.
 */
export async function getFriendsWithDiscordIds(
  dbClient: typeof db,
  friendIds: string[],
): Promise<
  { id: string; name: string; image: string | null; discordId: string | null }[]
> {
  if (friendIds.length === 0) return [];

  return dbClient
    .select({
      id: User.id,
      name: User.name,
      image: User.image,
      discordId: Account.accountId,
    })
    .from(User)
    .leftJoin(
      Account,
      and(
        eq(Account.userId, User.id),
        eq(Account.providerId, DISCORD_PROVIDER_ID),
      ),
    )
    .where(inArray(User.id, friendIds));
}

/**
 * Fetch group members with full details including Discord IDs.
 * Used by groups.get to display member list.
 */
export async function getGroupMembersWithDiscordIds(
  dbClient: typeof db,
  groupId: string,
): Promise<
  { id: string; name: string; image: string | null; discordId: string | null }[]
> {
  return dbClient
    .select({
      id: User.id,
      name: User.name,
      image: User.image,
      discordId: Account.accountId,
    })
    .from(GroupMember)
    .innerJoin(User, eq(User.id, GroupMember.userId))
    .leftJoin(
      Account,
      and(
        eq(Account.userId, User.id),
        eq(Account.providerId, DISCORD_PROVIDER_ID),
      ),
    )
    .where(eq(GroupMember.groupId, groupId));
}
