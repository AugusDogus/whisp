import type { TRPCRouterRecord } from "@trpc/server";
import { UTApi } from "uploadthing/server";
import { z } from "zod/v4";

import { and, eq, inArray, isNull } from "@acme/db";
import { Message, MessageDelivery } from "@acme/db/schema";

import { protectedProcedure } from "../trpc";

export const messagesRouter = {
  inbox: protectedProcedure.query(async ({ ctx }) => {
    const me = ctx.session.user.id;
    const deliveries = await ctx.db
      .select()
      .from(MessageDelivery)
      .where(
        and(
          eq(MessageDelivery.recipientId, me),
          isNull(MessageDelivery.readAt),
        ),
      );

    const messageIds = deliveries.map((d) => d.messageId);
    const messages = messageIds.length
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
          createdAt: m.createdAt,
        };
      })
      .filter(Boolean);
  }),

  outbox: protectedProcedure.query(async ({ ctx }) => {
    const me = ctx.session.user.id;
    const messages = await ctx.db
      .select()
      .from(Message)
      .where(eq(Message.senderId, me));
    return messages;
  }),

  markRead: protectedProcedure
    .input(z.object({ deliveryId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;
      // mark read if recipient owns it
      await ctx.db
        .update(MessageDelivery)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(MessageDelivery.id, input.deliveryId),
            eq(MessageDelivery.recipientId, me),
          ),
        );

      // Check if all deliveries for the message are read
      const delivery = (
        await ctx.db
          .select()
          .from(MessageDelivery)
          .where(eq(MessageDelivery.id, input.deliveryId))
      )[0];
      if (!delivery) return { ok: true };

      const unread = await ctx.db
        .select()
        .from(MessageDelivery)
        .where(
          and(
            eq(MessageDelivery.messageId, delivery.messageId),
            isNull(MessageDelivery.readAt),
          ),
        );
      if (unread.length > 0) return { ok: true };

      // All read -> delete file via UploadThing and soft-delete message
      const message = (
        await ctx.db
          .select()
          .from(Message)
          .where(eq(Message.id, delivery.messageId))
      )[0];
      if (message?.fileUrl && !message.deletedAt) {
        const utapi = new UTApi();
        const derivedKey = (() => {
          const key = (message as unknown as { fileKey?: string }).fileKey;
          if (key) return key;
          const url = message.fileUrl;
          const idx = url.indexOf("/f/");
          return idx >= 0 ? url.slice(idx + 3) : undefined;
        })();
        if (derivedKey) {
          await utapi.deleteFiles(derivedKey).catch(() => undefined);
        }
        await ctx.db
          .update(Message)
          .set({ deletedAt: new Date() })
          .where(eq(Message.id, message.id));
      }
      return { ok: true };
    }),

  cleanupIfAllRead: protectedProcedure
    .input(
      z.object({
        messageId: z.string().min(1),
        fileKey: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify all deliveries read
      const unread = await ctx.db
        .select()
        .from(MessageDelivery)
        .where(
          and(
            eq(MessageDelivery.messageId, input.messageId),
            isNull(MessageDelivery.readAt),
          ),
        )
        .limit(1);
      if (unread.length > 0) return { ok: false, reason: "unread" } as const;

      // delete file via UploadThing if we have key; then soft-delete message
      if (input.fileKey) {
        const utapi = new UTApi();
        await utapi.deleteFiles(input.fileKey).catch(() => undefined);
      }
      await ctx.db
        .update(Message)
        .set({ deletedAt: new Date() })
        .where(eq(Message.id, input.messageId));
      return { ok: true } as const;
    }),
} satisfies TRPCRouterRecord;
