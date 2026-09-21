/* eslint-disable unicorn/no-array-sort -- Every sorted array is newly allocated. */
import { eq, inArray } from "@acme/db";
import { MlsConversation, MlsDraft } from "@acme/db/schema";

import {
  mlsConflict,
  requireDevice,
  resolveRecipients,
  type MlsDatabase,
} from "./mls";

type Conversation = typeof MlsConversation.$inferSelect;

export function directScope(senderId: string, recipientId: string) {
  return JSON.stringify(["direct", ...[senderId, recipientId].sort()]);
}

function retiredScope(scope: string, id: string) {
  return JSON.stringify(["retired", scope, id]);
}

/** Retiring a session frees its canonical scope, but preserves every old delivery. */
export function hasConversationScope(
  conversation: Conversation,
  scope: string,
) {
  return (
    conversation.scope === scope ||
    conversation.scope === retiredScope(scope, conversation.id)
  );
}

function canSend(conversation: Conversation, deviceId: string) {
  return (
    conversation.revision === 0 ||
    conversation.members.some((m) => m.deviceId === deviceId)
  );
}

/** Caller holds a database transaction across session selection and draft creation. */
export async function prepareMlsDraft(
  tx: MlsDatabase,
  me: string,
  input: {
    deviceId: string;
    draftId?: string;
    recipients?: string[];
    groupId?: string;
  },
) {
  await requireDevice(tx, me, input.deviceId);
  const recipients = await resolveRecipients(tx, me, input);
  const draftId = input.draftId ?? crypto.randomUUID();
  const [draft] = await tx
    .select()
    .from(MlsDraft)
    .where(eq(MlsDraft.id, draftId));
  if (
    draft &&
    (draft.senderId !== me ||
      draft.senderDeviceId !== input.deviceId ||
      draft.groupId !== (input.groupId ?? null) ||
      JSON.stringify([...draft.recipients].sort()) !==
        JSON.stringify([...recipients].sort()) ||
      draft.expiresAt <= new Date())
  )
    mlsConflict(
      "This send ID belongs to another or expired draft. Send the whisp again.",
    );

  const previous = draft?.conversationIds.length
    ? await tx
        .select()
        .from(MlsConversation)
        .where(inArray(MlsConversation.id, draft.conversationIds))
    : [];
  const scopes = input.groupId
    ? [
        {
          scope: JSON.stringify(["group", input.groupId]),
          users: [me, ...recipients].sort(),
        },
      ]
    : recipients.map((recipient) => ({
        scope: directScope(me, recipient),
        users: [...new Set([me, recipient])].sort(),
      }));
  const conversationIds: string[] = [];
  for (const scope of scopes) {
    // Keep retries on their original session, including a published operation
    // whose response was lost. A paused, never-joined draft may move to recovery.
    const prior = previous.find((c) => hasConversationScope(c, scope.scope));
    if (prior && canSend(prior, input.deviceId)) {
      conversationIds.push(prior.id);
      continue;
    }
    const [active] = await tx
      .select()
      .from(MlsConversation)
      .where(eq(MlsConversation.scope, scope.scope));
    if (active && canSend(active, input.deviceId)) {
      conversationIds.push(active.id);
      continue;
    }
    if (active) {
      // The new device has no private group state or Welcome. Establish a new
      // session from registered public KeyPackages instead of requiring an old
      // device online. Old ciphertext and private state remain in the old session.
      await tx
        .update(MlsConversation)
        .set({ scope: retiredScope(scope.scope, active.id) })
        .where(eq(MlsConversation.id, active.id));
    }
    const id = crypto.randomUUID();
    await tx.insert(MlsConversation).values({
      id,
      scope: scope.scope,
      users: scope.users,
      groupId: input.groupId,
      members: [],
    });
    conversationIds.push(id);
  }
  if (draft) {
    if (
      JSON.stringify(draft.conversationIds) !== JSON.stringify(conversationIds)
    )
      await tx
        .update(MlsDraft)
        .set({ conversationIds })
        .where(eq(MlsDraft.id, draftId));
  } else {
    await tx.insert(MlsDraft).values({
      id: draftId,
      senderId: me,
      senderDeviceId: input.deviceId,
      recipients,
      groupId: input.groupId,
      conversationIds,
      expiresAt: new Date(Date.now() + 86400_000),
    });
  }
  return { draftId, conversations: conversationIds.map((id) => ({ id })) };
}
