import { toast } from "sonner-native";

import { createFile, uploadFilesWithInput } from "~/utils/uploadthing";

interface UploadMediaParams {
  uri: string;
  type: "photo" | "video";
  recipients: string[];
}

/**
 * Compresses and uploads media to recipients in the background
 * Navigation happens immediately while upload continues
 * @param params Upload parameters including URI, type, and recipients
 */
export async function uploadMedia(params: UploadMediaParams): Promise<void> {
  const { uri, type, recipients } = params;

  try {
    const file = await createFile(uri, type);
    void uploadFilesWithInput("imageUploader", {
      files: [file],
      input: { recipients, mimeType: type },
    })
      .then(() => toast.success("whisper sent"))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Upload failed"),
      );
  } catch (err) {
    console.error("[Upload] Failed to prepare file for upload:", err);
    toast.error("Failed to prepare media");
  }
}
