/* eslint-disable unicorn/no-array-sort -- This package targets ES2022; every sorted array is newly allocated. */
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { and, asc, desc, eq, gt, inArray, isNull } from "@acme/db";
import {
  MessageDelivery,
  MlsConversation,
  MlsDevice,
  MlsDraft,
  MlsDraftConversation,
  MlsEvent,
  MlsKeyPackage,
  MlsOperation,
  MlsWelcome,
  type MlsMember,
} from "@acme/db/schema";

import {
  conversationRoster,
  conversationUsers,
  mlsConflict,
  requireDevice,
  type MlsDatabase,
} from "../services/mls";
import { registerMlsDevice, signatureKey } from "../services/mls-device";
import { beginMlsOperation } from "../services/mls-operation";
import {
  directScope,
  hasConversationScope,
  prepareMlsDraft,
} from "../services/mls-preparation";
import { retainedMlsMessages } from "../services/mls-retention";
import { protectedProcedure } from "../trpc";

const id = z.uuid();
const wire = z
  .string()
  .min(4)
  .max(1400000)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const memberSchema = z.object({
  deviceId: id,
  userId: z.string().min(1),
  signatureKey: z.string().length(44),
});
const members = z.array(memberSchema).min(1).max(200);
const commit = z.object({ data: wire, members, welcome: wire.optional() });

async function authorizedConversation(
  database: MlsDatabase,
  conversationId: string,
  userId: string,
) {
  const [conversation] = await database
    .select()
    .from(MlsConversation)
    .where(eq(MlsConversation.id, conversationId));
  if (
    !conversation ||
    !(await conversationUsers(database, conversation)).includes(userId)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this encrypted conversation.",
    });
  return conversation;
}
function sameRoster(a: MlsMember[], b: MlsMember[]) {
  return (
    a.length === b.length &&
    new Set(a.map((m) => m.deviceId)).size === a.length &&
    a.every((member) =>
      b.some(
        (other) =>
          member.deviceId === other.deviceId &&
          member.userId === other.userId &&
          member.signatureKey === other.signatureKey,
      ),
    )
  );
}

async function descriptorPublished(
  database: MlsDatabase,
  userId: string,
  input: { deviceId: string; draftId: string; conversationId: string },
) {
  const [receipt] = await database
    .select({ id: MlsDraftConversation.id })
    .from(MlsDraftConversation)
    .innerJoin(MlsDraft, eq(MlsDraft.id, MlsDraftConversation.draftId))
    .where(
      and(
        eq(MlsDraft.id, input.draftId),
        eq(MlsDraft.senderId, userId),
        eq(MlsDraft.senderDeviceId, input.deviceId),
        eq(MlsDraftConversation.conversationId, input.conversationId),
      ),
    );
  return Boolean(receipt);
}

export const mlsConversationsRouter = {
  prepare: protectedProcedure
    .input(
      z
        .object({
          deviceId: id,
          draftId: id.optional(),
          signatureKey: signatureKey.optional(),
          recipients: z.array(z.string().min(1)).min(1).max(100).optional(),
          groupId: z.string().min(1).optional(),
        })
        .refine(
          (v) => Boolean(v.groupId) !== Boolean(v.recipients),
          "Choose recipients or a group",
        ),
    )
    .mutation(async ({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        if (input.signatureKey !== undefined)
          await registerMlsDevice(tx, ctx.session.user.id, {
            deviceId: input.deviceId,
            signatureKey: input.signatureKey,
          });
        const prepared = await prepareMlsDraft(tx, ctx.session.user.id, input);
        return {
          ...prepared,
          deviceIdentityValidated: input.signatureKey !== undefined,
          supportsAtomicBegin: true,
          supportsApplicationPublish: true,
        };
      }),
    ),
  sync: protectedProcedure
    .input(
      z.object({
        deviceId: id,
        conversationId: id,
        after: z.number().int().nonnegative(),
        draftId: id.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireDevice(ctx.db, ctx.session.user.id, input.deviceId);
      const conversation = await authorizedConversation(
        ctx.db,
        input.conversationId,
        ctx.session.user.id,
      );
      const [welcome] = await ctx.db
        .select()
        .from(MlsWelcome)
        .where(
          and(
            eq(MlsWelcome.conversationId, conversation.id),
            eq(MlsWelcome.deviceId, input.deviceId),
          ),
        )
        .orderBy(desc(MlsWelcome.sequence))
        .limit(1);
      // A device may only read the log from its Welcome onward. Missing a private
      // snapshot does not authorize reconstruction from someone else's keys.
      const isCreator = conversation.members.some(
        (m) => m.deviceId === input.deviceId,
      );
      if (!welcome && !isCreator && conversation.revision > 0)
        mlsConflict(
          "This device has not joined the conversation yet. Ask an existing member to open Whisp and send a message to add it.",
        );
      const after = Math.max(input.after, welcome?.sequence ?? 0);
      const events = await ctx.db
        .select()
        .from(MlsEvent)
        .where(
          and(
            eq(MlsEvent.conversationId, conversation.id),
            gt(MlsEvent.sequence, after),
          ),
        )
        .orderBy(asc(MlsEvent.sequence))
        .limit(100);
      return {
        conversation,
        welcome: input.after < (welcome?.sequence ?? 0) ? welcome : null,
        events,
        descriptorPublished: input.draftId
          ? await descriptorPublished(ctx.db, ctx.session.user.id, {
              deviceId: input.deviceId,
              conversationId: input.conversationId,
              draftId: input.draftId,
            })
          : undefined,
        retainedMessageIds:
          (events.at(-1)?.sequence ?? after) >= conversation.revision
            ? await retainedMlsMessages(
                ctx.db,
                conversation.id,
                ctx.session.user.id,
              )
            : undefined,
      };
    }),
  acknowledgeWelcome: protectedProcedure
    .input(z.object({ deviceId: id, keyPackageId: id }))
    .mutation(async ({ ctx, input }) => {
      await requireDevice(ctx.db, ctx.session.user.id, input.deviceId);
      await ctx.db
        .update(MlsWelcome)
        .set({ acknowledgedAt: new Date() })
        .where(
          and(
            eq(MlsWelcome.keyPackageId, input.keyPackageId),
            eq(MlsWelcome.deviceId, input.deviceId),
          ),
        );
      return { ok: true };
    }),
  begin: protectedProcedure
    .input(
      z.object({
        deviceId: id,
        conversationId: id,
        revision: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await requireDevice(tx, ctx.session.user.id, input.deviceId);
        const conversation = await authorizedConversation(
          tx,
          input.conversationId,
          ctx.session.user.id,
        );
        return beginMlsOperation(tx, conversation, input);
      }),
    ),
  beginSend: protectedProcedure
    .input(
      z.object({
        deviceId: id,
        conversationId: id,
        draftId: id,
        revision: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await requireDevice(tx, ctx.session.user.id, input.deviceId);
        const conversation = await authorizedConversation(
          tx,
          input.conversationId,
          ctx.session.user.id,
        );
        const [entry] = await tx
          .select({ draft: MlsDraft, receipt: MlsDraftConversation.id })
          .from(MlsDraft)
          .leftJoin(
            MlsDraftConversation,
            and(
              eq(MlsDraftConversation.draftId, MlsDraft.id),
              eq(MlsDraftConversation.conversationId, conversation.id),
            ),
          )
          .where(
            and(
              eq(MlsDraft.id, input.draftId),
              eq(MlsDraft.senderId, ctx.session.user.id),
              eq(MlsDraft.senderDeviceId, input.deviceId),
            ),
          );
        if (
          !entry ||
          entry.draft.expiresAt <= new Date() ||
          entry.draft.failure ||
          !entry.draft.conversationIds.includes(conversation.id)
        )
          mlsConflict(
            "This upload draft does not belong to the encrypted conversation or has expired. Send the whisp again.",
          );
        // Check publication before revision: a saved append whose job checkpoint
        // was interrupted must not reserve another operation or encrypt again.
        if (entry.receipt)
          return {
            kind: "published",
            retainedMessageIds: await retainedMlsMessages(
              tx,
              conversation.id,
              ctx.session.user.id,
            ),
          } as const;
        const operation = await beginMlsOperation(tx, conversation, input);
        const retainedMessageIds = await retainedMlsMessages(
          tx,
          conversation.id,
          ctx.session.user.id,
        );
        return { kind: "operation", operation, retainedMessageIds } as const;
      }),
    ),
  settle: protectedProcedure
    .input(z.object({ operationId: id, deviceId: id }))
    .mutation(async ({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await requireDevice(tx, ctx.session.user.id, input.deviceId);
        const [operation] = await tx
          .select()
          .from(MlsOperation)
          .where(
            and(
              eq(MlsOperation.id, input.operationId),
              eq(MlsOperation.deviceId, input.deviceId),
            ),
          );
        if (!operation)
          mlsConflict(
            "The pending encrypted operation is unavailable. Your previous conversation state is preserved.",
          );
        // Serialize cancellation against append. A late network request cannot be
        // accepted after the client has discarded its staged state.
        if (operation.revision === null)
          await tx
            .update(MlsOperation)
            .set({ expiresAt: new Date(0) })
            .where(eq(MlsOperation.id, operation.id));
        return { revision: operation.revision };
      }),
    ),
  append: protectedProcedure
    .input(
      z.object({
        operationId: id,
        deviceId: id,
        draftId: id,
        commits: z.array(commit).min(1).max(401),
        welcomes: z
          .array(
            z.object({
              keyPackageId: id,
              commitIndex: z.number().int().nonnegative(),
            }),
          )
          .max(200),
        ciphertext: wire,
      }),
    )
    .mutation(async ({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        // Keep the active device as the root so accepted-operation retries are
        // still authenticated even if their original draft is no longer present.
        const [context] = await tx
          .select({
            device: MlsDevice,
            operation: MlsOperation,
            conversation: MlsConversation,
            draft: MlsDraft,
          })
          .from(MlsDevice)
          .leftJoin(
            MlsOperation,
            and(
              eq(MlsOperation.id, input.operationId),
              eq(MlsOperation.deviceId, MlsDevice.id),
            ),
          )
          .leftJoin(
            MlsConversation,
            eq(MlsConversation.id, MlsOperation.conversationId),
          )
          .leftJoin(
            MlsDraft,
            and(
              eq(MlsDraft.id, input.draftId),
              eq(MlsDraft.senderId, ctx.session.user.id),
              eq(MlsDraft.senderDeviceId, MlsDevice.id),
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
        const { operation, conversation, draft } = context;
        if (!operation)
          mlsConflict(
            "This encrypted operation is unavailable. Sync and retry.",
          );
        if (operation.revision !== null)
          return { revision: operation.revision };
        if (operation.expiresAt <= new Date())
          mlsConflict("This encryption operation expired. Sync and retry.");
        const users = conversation
          ? await conversationUsers(tx, conversation)
          : [];
        if (!conversation || !users.includes(ctx.session.user.id))
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You are not a member of this encrypted conversation.",
          });
        if (
          !draft ||
          draft.expiresAt <= new Date() ||
          !draft.conversationIds.includes(conversation.id)
        )
          mlsConflict(
            "This upload draft does not belong to the encrypted conversation.",
          );
        const roster = await conversationRoster(tx, users);
        if (!sameRoster(roster, operation.members))
          throw new TRPCError({
            code: "CONFLICT",
            message: "Conversation membership changed. Sync and encrypt again.",
          });
        const finalCommit = input.commits.at(-1);
        if (!finalCommit || !sameRoster(finalCommit.members, roster))
          mlsConflict(
            "The encrypted commit does not include the current device roster.",
          );
        const allowed = new Map(
          [...conversation.members, ...roster].map((m) => [m.deviceId, m]),
        );
        for (const entry of input.commits) {
          if (
            new Set(entry.members.map((m) => m.deviceId)).size !==
              entry.members.length ||
            entry.members.some(
              (m) =>
                JSON.stringify(allowed.get(m.deviceId)) !== JSON.stringify(m),
            )
          )
            mlsConflict(
              "An MLS commit includes an unauthorized device identity.",
            );
        }
        const packages = await tx
          .select()
          .from(MlsKeyPackage)
          .where(eq(MlsKeyPackage.operationId, operation.id));
        if (
          packages.length !== input.welcomes.length ||
          new Set(input.welcomes.map((w) => w.keyPackageId)).size !==
            packages.length
        )
          mlsConflict("Every new member needs exactly one Welcome.");
        const welcomes: (typeof MlsWelcome.$inferInsert)[] = [];
        for (const welcome of input.welcomes) {
          const key = packages.find((p) => p.id === welcome.keyPackageId);
          const entry = input.commits[welcome.commitIndex];
          if (
            !key ||
            !entry?.welcome ||
            !entry.members.some((m) => m.deviceId === key.deviceId)
          )
            mlsConflict(
              "A Welcome does not match its reserved device and commit.",
            );
          welcomes.push({
            keyPackageId: key.id,
            conversationId: conversation.id,
            deviceId: key.deviceId,
            sequence: operation.baseRevision + welcome.commitIndex + 1,
            data: entry.welcome,
            members: entry.members,
          });
        }
        const revision = operation.baseRevision + input.commits.length + 1;
        const advanced = await tx
          .update(MlsConversation)
          .set({ revision, members: roster })
          .where(
            and(
              eq(MlsConversation.id, conversation.id),
              eq(MlsConversation.revision, operation.baseRevision),
            ),
          )
          .returning();
        if (!advanced.length)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Another device committed first. Sync and retry the send.",
          });
        await tx.insert(MlsDraftConversation).values({
          id: `${draft.id}:${conversation.id}`,
          draftId: draft.id,
          conversationId: conversation.id,
          members: roster,
        });
        const events: (typeof MlsEvent.$inferInsert)[] = input.commits.map(
          (entry, index) => ({
            id: crypto.randomUUID(),
            conversationId: conversation.id,
            sequence: operation.baseRevision + index + 1,
            entry: { kind: "commit", data: entry.data, members: entry.members },
          }),
        );
        events.push({
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
        await tx.insert(MlsEvent).values(events);
        if (welcomes.length) await tx.insert(MlsWelcome).values(welcomes);
        await tx
          .update(MlsOperation)
          .set({ revision })
          .where(eq(MlsOperation.id, operation.id));
        return { revision };
      }),
    ),
  descriptorPublished: protectedProcedure
    .input(z.object({ deviceId: id, draftId: id, conversationId: id }))
    .query(async ({ ctx, input }) => {
      await requireDevice(ctx.db, ctx.session.user.id, input.deviceId);
      return descriptorPublished(ctx.db, ctx.session.user.id, input);
    }),
  uploadStatus: protectedProcedure
    .input(z.object({ draftId: id }))
    .query(async ({ ctx, input }) => {
      const [draft] = await ctx.db
        .select()
        .from(MlsDraft)
        .where(
          and(
            eq(MlsDraft.id, input.draftId),
            eq(MlsDraft.senderId, ctx.session.user.id),
          ),
        );
      if (!draft)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This encrypted upload does not belong to your account.",
        });
      if (draft.completedAt) return { status: "sent" } as const;
      if (draft.failure || draft.expiresAt <= new Date())
        return {
          status: "failed",
          message:
            draft.failure ??
            "The encrypted upload expired. Send the whisp again.",
        } as const;
      return { status: "pending" } as const;
    }),
  retainedMessages: protectedProcedure
    .input(z.object({ deviceId: id, conversationId: id }))
    .query(async ({ ctx, input }) => {
      await requireDevice(ctx.db, ctx.session.user.id, input.deviceId);
      await authorizedConversation(
        ctx.db,
        input.conversationId,
        ctx.session.user.id,
      );
      return retainedMlsMessages(
        ctx.db,
        input.conversationId,
        ctx.session.user.id,
      );
    }),
  delivery: protectedProcedure
    .input(z.object({ deviceId: id, deliveryId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireDevice(ctx.db, ctx.session.user.id, input.deviceId);
      const [delivery] = await ctx.db
        .select()
        .from(MessageDelivery)
        .where(
          and(
            eq(MessageDelivery.id, input.deliveryId),
            eq(MessageDelivery.recipientId, ctx.session.user.id),
          ),
        );
      if (!delivery)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This whisp is not available to your account.",
        });
      if (delivery.readAt)
        mlsConflict(
          "This whisp has already been viewed on your account. Close the viewer and refresh your inbox.",
        );
      const [draft] = await ctx.db
        .select()
        .from(MlsDraft)
        .where(eq(MlsDraft.id, delivery.messageId));
      if (!draft) return { kind: "legacy" } as const;
      const scope = draft.groupId
        ? JSON.stringify(["group", draft.groupId])
        : directScope(draft.senderId, ctx.session.user.id);
      const conversations = await ctx.db
        .select()
        .from(MlsConversation)
        .where(inArray(MlsConversation.id, draft.conversationIds));
      const conversation = conversations.find((c) =>
        hasConversationScope(c, scope),
      );
      if (conversation) {
        await authorizedConversation(
          ctx.db,
          conversation.id,
          ctx.session.user.id,
        );
        return {
          kind: "mls" as const,
          messageId: delivery.messageId,
          conversationId: conversation.id,
          groupId: draft.groupId,
        };
      }
      mlsConflict(
        "The encrypted delivery is missing its conversation. It has not been marked read.",
      );
    }),
} satisfies TRPCRouterRecord;
