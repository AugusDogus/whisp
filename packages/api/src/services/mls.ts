/* eslint-disable unicorn/no-array-sort -- This package targets ES2022; every sorted array is newly allocated. */
import { TRPCError } from "@trpc/server";

import { and, eq, inArray, isNull, or } from "@acme/db";
import type { db } from "@acme/db/client";
import {
  Friendship,
  GroupMember,
  MlsDevice,
  MlsDraft,
  MlsConversation,
  MlsDraftConversation,
} from "@acme/db/schema";

export type MlsDatabase = Pick<
  typeof db,
  "select" | "insert" | "update" | "delete"
>;

export function mlsConflict(message: string): never {
  throw new TRPCError({ code: "PRECONDITION_FAILED", message });
}

export async function requireDevice(
  database: MlsDatabase,
  userId: string,
  deviceId: string,
) {
  const [device] = await database
    .select()
    .from(MlsDevice)
    .where(
      and(
        eq(MlsDevice.id, deviceId),
        eq(MlsDevice.userId, userId),
        isNull(MlsDevice.revokedAt),
      ),
    );
  if (!device)
    mlsConflict(
      "This encryption device is unavailable. Register this device before sending or opening whisps.",
    );
  return device;
}

export async function resolveRecipients(
  database: MlsDatabase,
  senderId: string,
  input: { recipients?: string[]; groupId?: string },
) {
  if (input.groupId) {
    const members = await database
      .select()
      .from(GroupMember)
      .where(eq(GroupMember.groupId, input.groupId));
    if (!members.some((m) => m.userId === senderId))
      mlsConflict(
        "You are no longer a member of this group. Refresh your groups before sending.",
      );
    const recipients = [
      ...new Set(members.map((m) => m.userId).filter((id) => id !== senderId)),
    ].sort();
    if (!recipients.length || recipients.length > 100)
      mlsConflict("Encrypted whisps require 1 to 100 recipients.");
    return recipients;
  }
  const recipients = [...new Set(input.recipients ?? [])].sort();
  const allowSelfMessages = process.env.ALLOW_SELF_MESSAGES === "true";
  if (recipients.includes(senderId) && !allowSelfMessages)
    mlsConflict(
      "Sending to yourself is disabled on this server. Your whisp is still queued. Reopen Whisp after self-send is enabled to retry.",
    );
  if (
    allowSelfMessages &&
    recipients.length === 1 &&
    recipients[0] === senderId
  )
    return recipients;
  const friends = await database
    .select()
    .from(Friendship)
    .where(
      or(eq(Friendship.userIdA, senderId), eq(Friendship.userIdB, senderId)),
    );
  const friendIds = new Set(
    friends.map((f) => (f.userIdA === senderId ? f.userIdB : f.userIdA)),
  );
  if (allowSelfMessages) friendIds.add(senderId);
  if (
    !recipients.length ||
    recipients.length > 100 ||
    recipients.some((id) => !friendIds.has(id))
  )
    mlsConflict("Choose 1 to 100 current friends before sending a whisp.");
  return recipients;
}

export async function conversationUsers(
  database: MlsDatabase,
  conversation: typeof MlsConversation.$inferSelect,
) {
  if (!conversation.groupId) return conversation.users;
  const members = await database
    .select()
    .from(GroupMember)
    .where(eq(GroupMember.groupId, conversation.groupId));
  return [...new Set(members.map((m) => m.userId))].sort();
}

export async function conversationRoster(
  database: MlsDatabase,
  users: string[],
) {
  const devices = users.length
    ? await database
        .select()
        .from(MlsDevice)
        .where(
          and(inArray(MlsDevice.userId, users), isNull(MlsDevice.revokedAt)),
        )
    : [];
  return validateRoster(users, devices);
}

function validateRoster(
  users: string[],
  devices: (typeof MlsDevice.$inferSelect)[],
) {
  if (users.some((userId) => !devices.some((d) => d.userId === userId)))
    mlsConflict(
      "A member has not registered an encryption device. Ask them to open the latest Whisp app, then retry.",
    );
  if (devices.length > 200)
    mlsConflict("This conversation exceeds 200 encryption devices.");
  return devices
    .map((d) => ({
      deviceId: d.id,
      userId: d.userId,
      signatureKey: d.signatureKey,
    }))
    .sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

export async function validateDraft(
  database: MlsDatabase,
  senderId: string,
  draftId: string,
) {
  const [row] = await database
    .select({ draft: MlsDraft, device: MlsDevice })
    .from(MlsDraft)
    .leftJoin(
      MlsDevice,
      and(
        eq(MlsDevice.id, MlsDraft.senderDeviceId),
        eq(MlsDevice.userId, senderId),
        isNull(MlsDevice.revokedAt),
      ),
    )
    .where(and(eq(MlsDraft.id, draftId), eq(MlsDraft.senderId, senderId)));
  const draft = row?.draft;
  if (!draft || draft.failure || draft.expiresAt <= new Date())
    mlsConflict(
      "This encrypted upload expired or is incomplete. Send the whisp again.",
    );
  if (!row?.device)
    mlsConflict(
      "This encryption device is unavailable. Register this device before sending or opening whisps.",
    );
  const current = await resolveRecipients(database, senderId, {
    recipients: draft.recipients,
    groupId: draft.groupId ?? undefined,
  });
  if (JSON.stringify(current) !== JSON.stringify(draft.recipients))
    mlsConflict(
      "Group membership changed while uploading. Send again to encrypt for the current members.",
    );
  // Read sealed receipts and current rosters in batches. Every conversation
  // still validates its own users and device limit before delivery is accepted.
  const rows = await database
    .select({ conversation: MlsConversation, sealed: MlsDraftConversation })
    .from(MlsConversation)
    .leftJoin(
      MlsDraftConversation,
      and(
        eq(MlsDraftConversation.conversationId, MlsConversation.id),
        eq(MlsDraftConversation.draftId, draft.id),
      ),
    )
    .where(inArray(MlsConversation.id, draft.conversationIds));
  const groupIds = [
    ...new Set(
      rows.flatMap(({ conversation }) =>
        conversation.groupId ? [conversation.groupId] : [],
      ),
    ),
  ];
  const members = groupIds.length
    ? await database
        .select()
        .from(GroupMember)
        .where(inArray(GroupMember.groupId, groupIds))
    : [];
  const conversations = new Map(
    rows.map((entry) => [
      entry.conversation.id,
      {
        ...entry,
        users: entry.conversation.groupId
          ? [
              ...new Set(
                members
                  .filter(
                    (member) => member.groupId === entry.conversation.groupId,
                  )
                  .map((member) => member.userId),
              ),
            ].sort()
          : entry.conversation.users,
      },
    ]),
  );
  const allUsers = [
    ...new Set([...conversations.values()].flatMap((entry) => entry.users)),
  ];
  const devices = allUsers.length
    ? await database
        .select()
        .from(MlsDevice)
        .where(
          and(inArray(MlsDevice.userId, allUsers), isNull(MlsDevice.revokedAt)),
        )
    : [];
  // Historical ciphertext cannot be recalled. Reject delivery if the active
  // roster changed after sealing, even before another device commits the change.
  for (const conversationId of draft.conversationIds) {
    const entry = conversations.get(conversationId);
    if (!entry)
      mlsConflict(
        "The encrypted conversation is unavailable. Refresh and retry.",
      );
    if (!entry.sealed)
      mlsConflict(
        "This whisp is not encrypted for every conversation yet. Retry the send.",
      );
    const roster = validateRoster(
      entry.users,
      devices.filter((device) => entry.users.includes(device.userId)),
    );
    if (JSON.stringify(roster) !== JSON.stringify(entry.sealed.members))
      mlsConflict(
        "Recipient devices changed while uploading. Send the whisp again.",
      );
  }
  return draft;
}
