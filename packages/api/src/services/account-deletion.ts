import type { PreviewScope } from "../uploadthing/preview-scope";

import { eq, inArray, or } from "@acme/db";
import type { db } from "@acme/db/client";
import {
  BackgroundUploadTestFile,
  FileDeletion,
  Group,
  Message,
  user,
} from "@acme/db/schema";

import { PreviewUploads } from "../uploadthing/preview-uploads";

export const AccountDeletion = {
  async remove(
    database: typeof db,
    userId: string,
    scope: PreviewScope | undefined,
  ) {
    await database.transaction(async (tx) => {
      const ownedGroups = tx
        .select({ id: Group.id })
        .from(Group)
        .where(eq(Group.createdById, userId));
      const messages = await tx
        .select({ fileKey: Message.fileKey, fileUrl: Message.fileUrl })
        .from(Message)
        .where(
          or(
            eq(Message.senderId, userId),
            inArray(Message.groupId, ownedGroups),
          ),
        );
      const testFiles = await tx
        .select({ fileKey: BackgroundUploadTestFile.fileKey })
        .from(BackgroundUploadTestFile)
        .where(eq(BackgroundUploadTestFile.userId, userId));
      const keys = new Set(testFiles.map((file) => file.fileKey));
      for (const message of messages) {
        // Legacy messages predate fileKey. Only accept the provider's /f/ URL.
        const legacy =
          /^https:\/\/(?:[^/]+\.)?(?:ufs\.sh|utfs\.io)\/f\/([^/?#]+)(?:[?#].*)?$/.exec(
            message.fileUrl,
          )?.[1];
        const key = message.fileKey ?? legacy;
        if (key) keys.add(key);
      }
      for (const fileKey of keys) {
        if (await PreviewUploads.canDelete(tx, scope, fileKey)) {
          await tx
            .insert(FileDeletion)
            .values({ fileKey })
            .onConflictDoNothing();
        }
      }
      // FKs delete credentials, profile, sessions, relationships, reports, blocks,
      // deliveries and messages atomically. Enforcement records are independent.
      await tx.delete(user).where(eq(user.id, userId));
    });
    return { success: true } as const;
  },
} as const;
