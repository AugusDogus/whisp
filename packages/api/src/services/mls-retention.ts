import type { MlsDatabase } from "./mls";

import { and, eq } from "@acme/db";
import {
  MessageDelivery,
  MlsDraft,
  MlsDraftConversation,
} from "@acme/db/schema";

/** Caller has authorized the device and current conversation membership. */
export async function retainedMlsMessages(
  database: MlsDatabase,
  conversationId: string,
  userId: string,
) {
  const rows = await database
    .select({ draft: MlsDraft, delivery: MessageDelivery })
    .from(MlsDraftConversation)
    .innerJoin(MlsDraft, eq(MlsDraft.id, MlsDraftConversation.draftId))
    .leftJoin(
      MessageDelivery,
      and(
        eq(MessageDelivery.messageId, MlsDraft.id),
        eq(MessageDelivery.recipientId, userId),
      ),
    )
    .where(eq(MlsDraftConversation.conversationId, conversationId));
  return rows
    .filter(({ draft, delivery }) =>
      delivery
        ? !delivery.readAt
        : !draft.completedAt &&
          draft.expiresAt > new Date() &&
          draft.recipients.includes(userId),
    )
    .map(({ draft }) => draft.id);
}
