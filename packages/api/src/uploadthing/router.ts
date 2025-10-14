import type { FileRouter } from "uploadthing/types";
import { createUploadthing, UploadThingError } from "uploadthing/server";
import { z } from "zod/v4";

import { db } from "@acme/db/client";
import { Message, MessageDelivery } from "@acme/db/schema";

import { notifyNewMessage } from "../utils/send-notification";

interface CreateDeps {
  getSession: () => Promise<{ user: { id: string } } | null>;
}

export function createUploadRouter({ getSession }: CreateDeps) {
  const f = createUploadthing();

  const uploadRouter = {
    imageUploader: f({
      image: {
        maxFileSize: "4MB",
        maxFileCount: 1,
      },
      video: {
        maxFileSize: "1GB",
        maxFileCount: 1,
      },
    })
      .input(
        z.object({
          recipients: z.array(z.string().min(1)).min(1),
          mimeType: z.string().optional(),
          thumbhash: z.string().optional(),
        }),
      )
      .middleware(async ({ input }) => {
        const session = await getSession();
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- UploadThingError maps to proper HTTP status in UploadThing
        if (!session) throw new UploadThingError("Unauthorized");
        return {
          userId: session.user.id,
          recipients: input.recipients,
          mimeType: input.mimeType,
          thumbhash: input.thumbhash,
        };
      })
      .onUploadComplete(async ({ metadata, file }) => {
        // Create message and deliveries
        const messageId = crypto.randomUUID();
        await db.insert(Message).values({
          id: messageId,
          senderId: metadata.userId,
          fileUrl: file.ufsUrl,
          fileKey: (file as unknown as { ufsKey?: string }).ufsKey ?? undefined,
          mimeType: metadata.mimeType,
          thumbhash: metadata.thumbhash,
        });

        // Create deliveries and track recipient -> deliveryId mapping
        const deliveries = metadata.recipients.map((rid) => ({
          id: crypto.randomUUID(),
          messageId,
          recipientId: rid,
        }));

        await db.insert(MessageDelivery).values(deliveries);

        // Get sender name for notification
        const sender = await db.query.user.findFirst({
          where: (users, { eq }) => eq(users.id, metadata.userId),
          columns: { name: true },
        });

        // Send notifications to all recipients with their specific deliveryId
        if (sender) {
          for (const delivery of deliveries) {
            void notifyNewMessage(
              db,
              delivery.recipientId,
              metadata.userId,
              sender.name,
              messageId,
              file.ufsUrl,
              metadata.mimeType,
              delivery.id, // Pass the real deliveryId!
              metadata.thumbhash,
            );
          }
        }

        return { uploadedBy: metadata.userId };
      }),
  } satisfies FileRouter;

  return uploadRouter;
}
