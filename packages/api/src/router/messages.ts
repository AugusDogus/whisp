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
          thumbhash: m.thumbhash ?? undefined,
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

      // All read -> soft-delete the message record, but DO NOT delete the file here.
      //
      // Deleting the remote file in the same mutation that marks the delivery as
      // read can race the client: on slow networks the viewer will open and then
      // the media URL is removed before it finishes loading, leaving only the
      // blurred placeholder.
      //
      // Actual file deletion is handled by `cleanupIfAllRead` (called when the
      // viewer closes).
      await ctx.db
        .update(Message)
        .set({ deletedAt: new Date() })
        .where(eq(Message.id, delivery.messageId));
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

      // Delete the underlying UploadThing file (best-effort), then soft-delete
      // the message record.
      const message = (
        await ctx.db
          .select()
          .from(Message)
          .where(eq(Message.id, input.messageId))
          .limit(1)
      )[0];

      const derivedKey =
        input.fileKey ??
        message?.fileKey ??
        (() => {
          const url = message?.fileUrl;
          if (!url) return undefined;
          const idx = url.indexOf("/f/");
          return idx >= 0 ? url.slice(idx + 3) : undefined;
        })();

      if (derivedKey) {
        const utapi = new UTApi();
        await utapi.deleteFiles(derivedKey).catch(() => undefined);
      }

      await ctx.db
        .update(Message)
        .set({ deletedAt: new Date() })
        .where(eq(Message.id, input.messageId));
      return { ok: true } as const;
    }),
} satisfies TRPCRouterRecord;
