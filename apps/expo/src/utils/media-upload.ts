import { Image } from "expo-image";
import * as VideoThumbnails from "expo-video-thumbnails";
import { toast } from "sonner-native";

import type { Annotation } from "@acme/validators";

import { createFile, uploadFilesWithInput } from "~/utils/uploadthing";

interface UploadMediaParams {
  uri: string;
  type: "photo" | "video";
  recipients: string[];
  annotations?: Annotation[];
}

/**
 * Generates a thumbhash for the given media URI
 * For images: generates directly from the image
 * For videos: extracts first frame, then generates thumbhash from that frame
 */
async function generateThumbhash(
  uri: string,
  type: "photo" | "video",
): Promise<string | undefined> {
  try {
    if (type === "photo") {
      // Generate thumbhash directly from image
      const thumbhash = await Image.generateThumbhashAsync(uri);
      return thumbhash;
    } else {
      // For videos, extract first frame then generate thumbhash
      const { uri: thumbnailUri } = await VideoThumbnails.getThumbnailAsync(
        uri,
        {
          time: 0, // First frame
          quality: 0.5, // Medium quality is fine for thumbhash
        },
      );
      const thumbhash = await Image.generateThumbhashAsync(thumbnailUri);
      return thumbhash;
    }
  } catch (err) {
    console.warn("[Thumbhash] Failed to generate thumbhash:", err);
    return undefined;
  }
}

/**
 * Compresses and uploads media to recipients in the background
 * Navigation happens immediately while upload continues
 * @param params Upload parameters including URI, type, and recipients
 */
export async function uploadMedia(params: UploadMediaParams): Promise<void> {
  const { uri, type, recipients, annotations } = params;

  try {
    // Generate thumbhash before upload
    const thumbhash = await generateThumbhash(uri, type);

    const file = await createFile(uri, type);
    // Use the file's actual MIME type instead of just "photo" or "video"
    const mimeType =
      file.type || (type === "photo" ? "image/jpeg" : "video/mp4");

    console.log("[Upload] File info:", {
      type,
      fileType: file.type,
      mimeType,
      hasThumbhash: !!thumbhash,
    });

    void uploadFilesWithInput("imageUploader", {
      files: [file],
      input: { recipients, mimeType, thumbhash, annotations },
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
