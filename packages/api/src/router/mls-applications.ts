import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { createHash } from "node:crypto";
import { z } from "zod/v4";

import { and, eq, isNull } from "@acme/db";
import {
  MlsApplicationAttempt,
  MlsConversation,
  MlsDevice,
  MlsDraft,
  MlsDraftConversation,
  MlsEvent,
} from "@acme/db/schema";

import {
  conversationRoster,
  conversationUsers,
  mlsConflict,
} from "../services/mls";
import { retainedMlsMessages } from "../services/mls-retention";
import { protectedProcedure } from "../trpc";

const ciphertext = z
  .string()
  .min(4)
  .max(1400000)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);

export const mlsApplicationsRouter = {
  publishApplication: protectedProcedure
    .input(
      z.object({
        deviceId: z.uuid(),
        conversationId: z.uuid(),
        draftId: z.uuid(),
        epoch: z.number().int().nonnegative(),
        ciphertext,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ciphertextHash = createHash("sha256")
        .update(Buffer.from(input.ciphertext, "base64"))
        .digest("hex");
      const attemptId = `${input.deviceId}:${input.draftId}:${input.conversationId}:${ciphertextHash}`;
      return ctx.db.transaction(async (tx) => {
        const [context] = await tx
          .select({
            deviceId: MlsDevice.id,
            conversation: MlsConversation,
            draft: MlsDraft,
            attempt: MlsApplicationAttempt,
            receipt: MlsDraftConversation.id,
          })
          .from(MlsDevice)
          .leftJoin(
            MlsConversation,
            eq(MlsConversation.id, input.conversationId),
          )
          .leftJoin(MlsDraft, eq(MlsDraft.id, input.draftId))
          .leftJoin(
            MlsApplicationAttempt,
            eq(MlsApplicationAttempt.id, attemptId),
          )
          .leftJoin(
            MlsDraftConversation,
            eq(
              MlsDraftConversation.id,
              `${input.draftId}:${input.conversationId}`,
            ),
          )
          .where(
            and(
              eq(MlsDevice.id, input.deviceId),
              eq(MlsDevice.userId, ctx.session.user.id),
              isNull(MlsDevice.revokedAt),
            ),
          );
        if (!context)
          mlsConflict(
            "This encryption device is unavailable. Register this device before sending or opening whisps.",
          );
        const { conversation, draft, attempt, receipt } = context;
        const users = conversation
          ? await conversationUsers(tx, conversation)
          : [];
        if (!conversation || !users.includes(ctx.session.user.id))
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You are not a member of this encrypted conversation.",
          });
        // Resolve exact retries before current epoch, roster, or draft lifetime.
        // A draft may have been cleaned up after the server accepted its message.
        if (attempt) {
          if (attempt.epoch !== input.epoch)
            mlsConflict(
              "This ciphertext was submitted with a different MLS epoch. Preserve the queued send and reopen whisp.",
            );
          if (attempt.revision === null) return { kind: "cancelled" } as const;
          return {
            kind: "published",
            revision: attempt.revision,
            epoch: attempt.epoch,
            retainedMessageIds: await retainedMlsMessages(
              tx,
              conversation.id,
              ctx.session.user.id,
            ),
          } as const;
        }
        if (
          draft &&
          (draft.senderId !== ctx.session.user.id ||
            draft.senderDeviceId !== input.deviceId)
        )
          mlsConflict(
            "This encrypted upload belongs to a different account or device.",
          );
        const identity = {
          id: attemptId,
          draftId: input.draftId,
          conversationId: conversation.id,
          deviceId: input.deviceId,
          epoch: input.epoch,
          ciphertextHash,
        };
        const cancel = async () => {
          await tx
            .insert(MlsApplicationAttempt)
            .values({ ...identity, revision: null });
          return { kind: "cancelled" } as const;
        };
        // Decisions commit instead of throwing: a delayed duplicate can never
        // resurrect a rejected generation after the roster changes back.
        if (
          !draft ||
          draft.expiresAt <= new Date() ||
          draft.failure ||
          draft.completedAt ||
          !draft.conversationIds.includes(conversation.id) ||
          receipt ||
          conversation.epoch !== input.epoch ||
          !conversation.members.some(
            (member) =>
              member.deviceId === input.deviceId &&
              member.userId === ctx.session.user.id,
          )
        )
          return cancel();
        let roster: Awaited<ReturnType<typeof conversationRoster>>;
        try {
          roster = await conversationRoster(tx, users);
        } catch (error) {
          if (
            error instanceof TRPCError &&
            error.code === "PRECONDITION_FAILED"
          )
            return cancel();
          throw error;
        }
        // Both rosters are canonical server-produced arrays, ordered by device.
        if (JSON.stringify(roster) !== JSON.stringify(conversation.members))
          return cancel();
        const revision = conversation.revision + 1;
        const advanced = await tx
          .update(MlsConversation)
          .set({ revision })
          .where(
            and(
              eq(MlsConversation.id, conversation.id),
              eq(MlsConversation.revision, conversation.revision),
              eq(MlsConversation.epoch, input.epoch),
            ),
          )
          .returning({ revision: MlsConversation.revision });
        if (!advanced.length)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The conversation advanced concurrently. Retry the same encrypted message.",
          });
        await tx.insert(MlsEvent).values({
          id: crypto.randomUUID(),
          conversationId: conversation.id,
          sequence: revision,
          entry: {
            kind: "application",
            data: input.ciphertext,
            messageId: draft.id,
            senderId: draft.senderId,
            senderDeviceId: input.deviceId,
            groupId: draft.groupId,
          },
        });
        await tx.insert(MlsDraftConversation).values({
          id: `${draft.id}:${conversation.id}`,
          draftId: draft.id,
          conversationId: conversation.id,
          members: roster,
        });
        await tx
          .insert(MlsApplicationAttempt)
          .values({ ...identity, revision });
        return {
          kind: "published",
          revision,
          epoch: input.epoch,
          retainedMessageIds: await retainedMlsMessages(
            tx,
            conversation.id,
            ctx.session.user.id,
          ),
        } as const;
      });
    }),
} satisfies TRPCRouterRecord;
