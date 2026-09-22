import { UploadThingError } from "uploadthing/server";

import { eq } from "@acme/db";
import type { db as database } from "@acme/db/client";
import { PreviewUpload, PreviewUploadControl } from "@acme/db/schema";

import { PreviewScope } from "./preview-scope";

export const PreviewUploads = {
  async assertOpen(db: typeof database, scope: PreviewScope | undefined) {
    if (!scope) return;
    const [control] = await db
      .select()
      .from(PreviewUploadControl)
      .where(eq(PreviewUploadControl.scope, scope.prefix))
      .limit(1);
    if (control?.state !== "open") {
      throw new UploadThingError(
        "This preview is closed or not initialized. Open a current PR preview to upload files.",
      );
    }
  },
  async record(
    db: typeof database,
    scope: PreviewScope | undefined,
    file: { key: string; customId: string | null },
  ) {
    if (!scope) return;
    if (!file.customId || !PreviewScope.owns(scope, file.customId)) {
      throw new UploadThingError(
        "Upload callback has no matching preview identifier. The file was not attached to a message.",
      );
    }
    await db
      .insert(PreviewUpload)
      .values({ fileKey: file.key, customId: file.customId })
      .onConflictDoNothing();
  },
  async canDelete(
    db: Pick<typeof database, "select">,
    scope: PreviewScope | undefined,
    fileKey: string,
  ) {
    if (!scope) return true;
    const [file] = await db
      .select()
      .from(PreviewUpload)
      .where(eq(PreviewUpload.fileKey, fileKey))
      .limit(1);
    return PreviewScope.owns(scope, file?.customId ?? null);
  },
} as const;
