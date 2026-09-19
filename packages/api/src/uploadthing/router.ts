import type { FileRouter } from "uploadthing/types";

import { TRPCError } from "@trpc/server";
import {
  createUploadthing,
  UploadThingError,
  UTApi,
  UTFiles,
} from "uploadthing/server";
import { z } from "zod/v4";

import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import {
  BackgroundUploadTestFile,
  MlsDraft,
  Message,
  MessageDelivery,
} from "@acme/db/schema";

import { validateDraft } from "../services/mls";
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
    // Keep the route name so existing background-task reconciliation still works.
    // Old clients are rejected by the required encrypted draft input.
    imageUploader: f({ blob: { maxFileSize: "1GB", maxFileCount: 1 } })
      .input(z.object({ draftId: z.uuid() }).strict())
      .middleware(async ({ input, files }) => {
        const session = await getSession();
        if (!session) throw new UploadThingError("Unauthorized");
        const scope = PreviewScope.fromEnvironment(process.env);
        await PreviewUploads.assertOpen(db, scope);
        const draft = await validateDraft(db, session.user.id, input.draftId);
        if (draft.completedAt)
          throw new UploadThingError("This whisp has already been uploaded.");
        return {
          [UTFiles]: files.map((file) => ({
            ...file,
            ...(scope
              ? { customId: `${scope.prefix}${crypto.randomUUID()}` }
              : {}),
          })),
          userId: session.user.id,
          draftId: draft.id,
        };
      })
      .onUploadComplete(async ({ metadata, file }) => {
        await PreviewUploads.record(
          db,
          PreviewScope.fromEnvironment(process.env),
          { key: getFileKey(file), customId: file.customId },
        );
        const result = await db
          .transaction(async (tx) => {
            // Callback retries are idempotent. A second file cannot replace the first.
            const [existing] = await tx
              .select()
              .from(Message)
              .where(eq(Message.id, metadata.draftId));
            if (existing)
              return { kind: "duplicate" as const, fileKey: existing.fileKey };
            const draft = await validateDraft(
              tx,
              metadata.userId,
              metadata.draftId,
            );
            await tx.insert(Message).values({
              id: draft.id,
              senderId: draft.senderId,
              groupId: draft.groupId,
              fileUrl: file.ufsUrl,
              fileKey: getFileKey(file),
              // Explicit protocol marker. Media kind and previews stay inside MLS.
              mimeType: "application/vnd.whisp.mls.v1",
            });
            const deliveries = draft.recipients.map((recipientId) => ({
              id: crypto.randomUUID(),
              messageId: draft.id,
              recipientId,
              groupId: draft.groupId,
            }));
            await tx.insert(MessageDelivery).values(deliveries);
            await tx
              .update(MlsDraft)
              .set({ completedAt: new Date() })
              .where(eq(MlsDraft.id, draft.id));
            return { kind: "created" as const, draft, deliveries };
          })
          .catch(async (error: unknown) => {
            // A DB/network error can have an ambiguous commit outcome. Never
            // delete ciphertext that may already be referenced by a delivery.
            if (error instanceof TRPCError) {
              await db
                .update(MlsDraft)
                .set({ failure: error.message })
                .where(
                  and(
                    eq(MlsDraft.id, metadata.draftId),
                    isNull(MlsDraft.completedAt),
                  ),
                );
              await new UTApi().deleteFiles(getFileKey(file));
            }
            throw error;
          });
        if (result.kind === "duplicate") {
          if (result.fileKey !== getFileKey(file))
            await new UTApi().deleteFiles(getFileKey(file));
          return { uploadedBy: metadata.userId };
        }
        const sender = await db.query.user.findFirst({
          where: (u, { eq: columnEq }) => columnEq(u.id, metadata.userId),
          columns: { name: true },
        });
        for (const delivery of result.deliveries) {
          if (!result.draft.groupId)
            await updateStreak(db, metadata.userId, delivery.recipientId);
          if (sender)
            void notifyNewMessage(
              db,
              delivery.recipientId,
              metadata.userId,
              sender.name,
              result.draft.id,
              undefined,
              undefined,
              delivery.id,
              undefined,
              result.draft.groupId
                ? { groupId: result.draft.groupId, groupName: "your group" }
                : undefined,
            );
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
        await db
          .insert(BackgroundUploadTestFile)
          .values({
            userId: metadata.userId,
            fileKey: getFileKey(file),
            fileUrl: file.ufsUrl,
            originalFileName: file.name,
            mimeType: file.type,
          })
          .onConflictDoNothing({ target: BackgroundUploadTestFile.fileKey });

        return { uploadedBy: metadata.userId };
      }),
  } satisfies FileRouter;

  return uploadRouter;
}
