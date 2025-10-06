import type { FileRouter } from "uploadthing/types";
import { createUploadthing, UploadThingError } from "uploadthing/server";

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
      .middleware(async () => {
        const session = await getSession();
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- UploadThingError maps to proper HTTP status in UploadThing
        if (!session) throw new UploadThingError("Unauthorized");
        return { userId: session.user.id };
      })
      .onUploadComplete(({ metadata, file }) => {
        console.log("Upload complete for userId:", metadata.userId);
        console.log("file url", file.ufsUrl);
        return { uploadedBy: metadata.userId };
      }),
  } satisfies FileRouter;

  return uploadRouter;
}
