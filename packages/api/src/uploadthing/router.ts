import type { FileRouter } from "uploadthing/types";

import {
  createUploadthing,
  UploadThingError,
  UTFiles,
  UTApi,
} from "uploadthing/server";
import { z } from "zod/v4";

import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import {
  BackgroundUploadTestFile,
  Message,
  MessageDelivery,
  FileDeletion,
  user,
} from "@acme/db/schema";

import { FileDeletions } from "../services/file-deletions";
import { MessageRecipients } from "../services/message-recipients";
import { notifyNewMessage } from "../utils/send-notification";
import { updateStreak } from "../utils/update-streak";
import { PreviewScope } from "./preview-scope";
import { PreviewUploads } from "./preview-uploads";

interface CreateDeps {
  getSession: () => Promise<{ user: { id: string } } | null>;
}

function getFileKey(file: { key: string; ufsUrl: string }): string {
  return (file as unknown as { ufsKey?: string }).ufsKey ?? file.key;
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
          recipients: z.array(z.string().min(1)).max(100).optional(),
          groupId: z.string().min(1).optional(),
          mimeType: z.string().optional(),
          thumbhash: z.string().optional(),
        }),
      )
      .middleware(async ({ input, files }) => {
        const session = await getSession();
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- UploadThingError maps to proper HTTP status in UploadThing
        if (!session) throw new UploadThingError("Unauthorized");
        const scope = PreviewScope.fromEnvironment(process.env);
        await PreviewUploads.assertOpen(db, scope);
        const recipients = await MessageRecipients.resolve(
          db,
          session.user.id,
          input,
        );
        if (recipients.status !== "ready") {
          throw new UploadThingError(
            "Cannot send to these recipients. Check terms acceptance in Profile, your friendship, and group membership, then try again.",
          );
        }
        return {
          [UTFiles]: files.map((file) => ({
            ...file,
            ...(scope
              ? { customId: `${scope.prefix}${crypto.randomUUID()}` }
              : {}),
          })),
          userId: session.user.id,
          recipients: input.recipients ?? [],
          groupId: input.groupId,
          mimeType: input.mimeType,
          thumbhash: input.thumbhash,
        };
      })
      .onUploadComplete(async ({ metadata, file }) => {
        await PreviewUploads.record(
          db,
          PreviewScope.fromEnvironment(process.env),
          { key: getFileKey(file), customId: file.customId },
        );
        const messageId = crypto.randomUUID();
        const isGroupMessage = Boolean(metadata.groupId);

        const result = await db.transaction(async (tx) => {
          const recipients = await MessageRecipients.resolve(
            tx,
            metadata.userId,
            metadata,
          );
          if (recipients.status !== "ready") {
            await tx
              .insert(FileDeletion)
              .values({ fileKey: getFileKey(file) })
              .onConflictDoNothing();
            return { status: "unavailable" } as const;
          }
          await tx.insert(Message).values({
            id: messageId,
            senderId: metadata.userId,
            groupId: metadata.groupId,
            fileUrl: file.ufsUrl,
            fileKey: getFileKey(file),
            mimeType: metadata.mimeType,
            thumbhash: metadata.thumbhash,
          });
          const deliveries = recipients.recipientIds.map((recipientId) => ({
            id: crypto.randomUUID(),
            messageId,
            recipientId,
            groupId: metadata.groupId,
          }));
          await tx.insert(MessageDelivery).values(deliveries);
          return { status: "delivered", deliveries } as const;
        });
        if (result.status !== "delivered") {
          const cleanup = await FileDeletions.process(
            db,
            PreviewScope.fromEnvironment(process.env),
            getFileKey(file),
            (key) => new UTApi().deleteFiles(key),
          );
          if (cleanup.status === "failed")
            throw new UploadThingError(
              "Delivery was cancelled. Uploaded file cleanup is queued for retry.",
            );
          throw new UploadThingError(
            "Delivery was cancelled because the recipients or account permissions changed during upload.",
          );
        }
        const deliveries = result.deliveries;
        if (!isGroupMessage) {
          for (const delivery of deliveries) {
            await updateStreak(db, metadata.userId, delivery.recipientId);
          }
        }

        const sender = await db.query.user.findFirst({
          where: (users, { eq: colEq }) => colEq(users.id, metadata.userId),
          columns: { name: true },
        });

        const groupIdForQuery = metadata.groupId;
        const groupQuery =
          groupIdForQuery &&
          db.query.Group.findFirst({
            where: (g, { eq: colEq }) => colEq(g.id, groupIdForQuery),
            columns: { name: true },
          });
        const groupResult: { name: string } | null = groupQuery
          ? ((await groupQuery) ?? null)
          : null;

        if (sender) {
          for (const delivery of deliveries) {
            void notifyNewMessage(
              db,
              delivery.recipientId,
              metadata.userId,
              sender.name,
              messageId,
              delivery.groupId
                ? {
                    groupId: delivery.groupId,
                    groupName: groupResult?.name ?? "Group",
                  }
                : undefined,
            );
          }
        }

        return { uploadedBy: metadata.userId };
      }),
    backgroundUploadTestUploader: f({
      image: {
        maxFileSize: "8MB",
        maxFileCount: 10,
      },
      video: {
        maxFileSize: "1GB",
        maxFileCount: 10,
      },
      blob: {
        maxFileSize: "1GB",
        maxFileCount: 10,
      },
      "application/octet-stream": {
        maxFileSize: "1GB",
        maxFileCount: 10,
      },
    })
      .input(z.object({}))
      .middleware(async ({ files }) => {
        const session = await getSession();
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- UploadThingError maps to proper HTTP status in UploadThing
        if (!session) throw new UploadThingError("Unauthorized");
        const scope = PreviewScope.fromEnvironment(process.env);
        await PreviewUploads.assertOpen(db, scope);
        if (process.env.ENABLE_BACKGROUND_UPLOAD_TEST_PAGE !== "true") {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- UploadThingError maps to proper HTTP status in UploadThing
          throw new UploadThingError("Background upload test page is disabled");
        }

        return {
          [UTFiles]: files.map((file) => ({
            ...file,
            ...(scope
              ? { customId: `${scope.prefix}${crypto.randomUUID()}` }
              : {}),
          })),
          userId: session.user.id,
        };
      })
      .onUploadComplete(async ({ metadata, file }) => {
        await PreviewUploads.record(
          db,
          PreviewScope.fromEnvironment(process.env),
          { key: getFileKey(file), customId: file.customId },
        );
        const saved = await db.transaction(async (tx) => {
          const [owner] = await tx
            .select({ id: user.id })
            .from(user)
            .where(eq(user.id, metadata.userId));
          if (!owner) {
            await tx
              .insert(FileDeletion)
              .values({ fileKey: getFileKey(file) })
              .onConflictDoNothing();
            return false;
          }
          await tx
            .insert(BackgroundUploadTestFile)
            .values({
              userId: metadata.userId,
              fileKey: getFileKey(file),
              fileUrl: file.ufsUrl,
              originalFileName: file.name,
              mimeType: file.type,
            })
            .onConflictDoNothing({ target: BackgroundUploadTestFile.fileKey });
          return true;
        });
        if (!saved)
          throw new UploadThingError(
            "Account deleted during upload. File cleanup is queued.",
          );

        return { uploadedBy: metadata.userId };
      }),
  } satisfies FileRouter;

  return uploadRouter;
}
