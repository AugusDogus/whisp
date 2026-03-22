import type { FileRouter } from "uploadthing/types";

import { createUploadthing, UploadThingError } from "uploadthing/server";
import { z } from "zod/v4";

import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import {
  BackgroundUploadTestFile,
  GroupMember,
  Message,
  MessageDelivery,
} from "@acme/db/schema";

import { notifyNewMessage } from "../utils/send-notification";
import { updateStreak } from "../utils/update-streak";

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
          recipients: z.array(z.string().min(1)).optional(),
          groupId: z.string().min(1).optional(),
          mimeType: z.string().optional(),
          thumbhash: z.string().optional(),
        }),
      )
      .middleware(async ({ input }) => {
        const session = await getSession();
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- UploadThingError maps to proper HTTP status in UploadThing
        if (!session) throw new UploadThingError("Unauthorized");
        const hasRecipients = input.recipients && input.recipients.length > 0;
        const hasGroupId = Boolean(input.groupId);
        if (!hasRecipients && !hasGroupId) {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- UploadThingError
          throw new UploadThingError(
            "Either recipients or groupId is required",
          );
        }
        if (hasRecipients && hasGroupId) {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- UploadThingError
          throw new UploadThingError(
            "Cannot specify both recipients and groupId",
          );
        }
        if (hasGroupId && input.groupId) {
          const [membership] = await db
            .select()
            .from(GroupMember)
            .where(
              and(
                eq(GroupMember.groupId, input.groupId),
                eq(GroupMember.userId, session.user.id),
              ),
            )
            .limit(1);
          if (!membership) {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- UploadThingError
            throw new UploadThingError("Not a member of this group");
          }
        }
        return {
          userId: session.user.id,
          recipients: input.recipients ?? [],
          groupId: input.groupId,
          mimeType: input.mimeType,
          thumbhash: input.thumbhash,
        };
      })
      .onUploadComplete(async ({ metadata, file }) => {
        const messageId = crypto.randomUUID();
        const isGroupMessage = Boolean(metadata.groupId);

        await db.insert(Message).values({
          id: messageId,
          senderId: metadata.userId,
          groupId: metadata.groupId ?? undefined,
          fileUrl: file.ufsUrl,
          fileKey: getFileKey(file),
          mimeType: metadata.mimeType,
          thumbhash: metadata.thumbhash,
        });

        let deliveries: {
          id: string;
          messageId: string;
          recipientId: string;
          groupId?: string;
        }[];

        if (isGroupMessage && metadata.groupId) {
          const groupId = metadata.groupId;
          const members = await db
            .select({ userId: GroupMember.userId })
            .from(GroupMember)
            .where(eq(GroupMember.groupId, groupId));
          const recipientIds = members
            .map((m) => m.userId)
            .filter((id) => id !== metadata.userId);
          deliveries = recipientIds.map((rid) => ({
            id: crypto.randomUUID(),
            messageId,
            recipientId: rid,
            groupId,
          }));
        } else if (metadata.recipients.length > 0) {
          deliveries = metadata.recipients.map((rid) => ({
            id: crypto.randomUUID(),
            messageId,
            recipientId: rid,
          }));
        } else {
          deliveries = [];
        }

        await db.insert(MessageDelivery).values(deliveries);

        if (!isGroupMessage) {
          for (const recipientId of metadata.recipients) {
            await updateStreak(db, metadata.userId, recipientId);
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
              file.ufsUrl,
              metadata.mimeType,
              delivery.id,
              metadata.thumbhash,
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
    })
      .input(z.object({}))
      .middleware(async () => {
        const session = await getSession();
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- UploadThingError maps to proper HTTP status in UploadThing
        if (!session) throw new UploadThingError("Unauthorized");
        if (process.env.ENABLE_BACKGROUND_UPLOAD_TEST_PAGE !== "true") {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- UploadThingError maps to proper HTTP status in UploadThing
          throw new UploadThingError("Background upload test page is disabled");
        }

        return {
          userId: session.user.id,
        };
      })
      .onUploadComplete(async ({ metadata, file }) => {
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
