import { Image } from "expo-image";
import * as VideoThumbnails from "expo-video-thumbnails";
import { toast } from "sonner-native";

import type { FriendsListOutput } from "~/utils/api";
import type { MediaKind } from "~/utils/media-kind";
import { queryClient } from "~/utils/api";
import {
  markWhispFailed,
  markWhispSent,
  markWhispUploading,
} from "~/utils/outbox-status";
import { createFile, uploadFilesWithInput } from "~/utils/uploadthing";

interface UploadMediaParams {
  uri: string;
  type: "photo" | "video";
  recipients: string[];
  groupId?: string;
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
  const { uri, type, recipients, groupId } = params;
  const isGroupSend = Boolean(groupId);

  const mediaKind: MediaKind = type === "video" ? "video" : "photo";

  try {
    if (!isGroupSend && recipients.length > 0) {
      markWhispUploading(recipients, mediaKind);
    }

    const thumbhash = await generateThumbhash(uri, type);

    const file = await createFile(uri, type);
    const mimeType =
      file.type || (type === "photo" ? "image/jpeg" : "video/mp4");

    const uploadInput = isGroupSend
      ? { groupId: groupId ?? "", mimeType, thumbhash }
      : { recipients, mimeType, thumbhash };

    void uploadFilesWithInput("imageUploader", {
      files: [file],
      input: uploadInput,
    })
      .then(() => {
        toast.success("whisp sent");
        if (!isGroupSend && recipients.length > 0) {
          markWhispSent(recipients, mediaKind);
        }

        if (!isGroupSend) {
          const friendsKeyPrefix = [["friends", "list"]] as const;
          queryClient.setQueriesData<FriendsListOutput>(
            { queryKey: friendsKeyPrefix },
            (old) => {
              if (!old) return old;
              const now = new Date();
              const recipientSet = new Set(recipients);
              return old.map((f) => {
                if (!recipientSet.has(f.id)) return f;
                return {
                  ...f,
                  lastActivityTimestamp: now,
                  lastSentOpened: false,
                } as typeof f;
              });
            },
          );
        }

        void queryClient.invalidateQueries({
          queryKey: [["friends", "list"]] as const,
        });
        void queryClient.invalidateQueries({
          queryKey: [["messages", "inbox"]] as const,
        });
        if (isGroupSend && groupId) {
          void queryClient.invalidateQueries({
            queryKey: [["groups", "list"]] as const,
          });
          void queryClient.invalidateQueries({
            predicate: (query) => {
              const key = query.queryKey as [string[], ...unknown[]];
              return (
                Array.isArray(key[0]) &&
                key[0][0] === "groups" &&
                key[0][1] === "inbox"
              );
            },
          });
        }
      })
      .catch((err: unknown) => {
        if (!isGroupSend && recipients.length > 0) {
          markWhispFailed(recipients);
        }
        toast.error(err instanceof Error ? err.message : "Upload failed");
      });
  } catch (err) {
    console.error("[Upload] Failed to prepare file for upload:", err);
    if (!isGroupSend && recipients.length > 0) {
      markWhispFailed(recipients);
    }
    toast.error("Failed to prepare media");
  }
}
