import { Image } from "expo-image";
import * as VideoThumbnails from "expo-video-thumbnails";

import { toast } from "sonner-native";

import type { FriendsListOutput } from "~/utils/api";
import { queryClient } from "~/utils/api";
import type { MediaKind } from "~/utils/media-kind";
import {
  markWhispFailed,
  markWhispSent,
  markWhispUploading,
} from "~/utils/outbox-status";
import {
  createFile,
  removeBackgroundUploadTask,
  type BackgroundUploadTask,
  uploadFilesWithInputInBackground,
} from "~/utils/uploadthing";

interface UploadMediaParams {
  uri: string;
  type: "photo" | "video";
  recipients: string[];
  groupId?: string;
}

function isSuccessfulBackgroundTask(task: BackgroundUploadTask) {
  return task.status === "completed";
}

async function cleanupBackgroundTasks(tasks: BackgroundUploadTask[]) {
  const uniqueTaskIds = [...new Set(tasks.map((task) => task.taskId))];
  await Promise.allSettled(
    uniqueTaskIds.map((taskId) => removeBackgroundUploadTask(taskId)),
  );
}

function invalidateUploadRelatedQueries(
  isGroupSend: boolean,
  groupId?: string,
) {
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
}

function applySuccessfulUploadSideEffects(params: {
  recipients: string[];
  mediaKind: MediaKind;
  isGroupSend: boolean;
  groupId?: string;
}) {
  const { recipients, mediaKind, isGroupSend, groupId } = params;

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

  invalidateUploadRelatedQueries(isGroupSend, groupId);
}

function applyFailedUploadSideEffects(params: {
  recipients: string[];
  isGroupSend: boolean;
  message?: string;
}) {
  const { recipients, isGroupSend, message } = params;

  if (!isGroupSend && recipients.length > 0) {
    markWhispFailed(recipients);
  }
  toast.error(message ?? "Upload failed");
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

    if (isGroupSend && (!groupId || groupId.trim().length === 0)) {
      throw new Error("A group upload requires a valid groupId.");
    }

    const uploadInput = isGroupSend
      ? { groupId, mimeType, thumbhash }
      : { recipients, mimeType, thumbhash };

    const backgroundBatch = await uploadFilesWithInputInBackground(
      "imageUploader",
      {
        files: [file],
        input: uploadInput,
      },
    );

    let tasksForCleanup: BackgroundUploadTask[] = backgroundBatch.tasks;

    void backgroundBatch.completion
      .then((tasks) => {
        tasksForCleanup = tasks;
        const failedTask = tasks.find(
          (task) => !isSuccessfulBackgroundTask(task),
        );
        if (failedTask) {
          applyFailedUploadSideEffects({
            recipients,
            isGroupSend,
            message: failedTask.errorMessage ?? "Upload failed",
          });
          return;
        }

        applySuccessfulUploadSideEffects({
          recipients,
          mediaKind,
          isGroupSend,
          groupId,
        });
      })
      .catch((err: unknown) => {
        applyFailedUploadSideEffects({
          recipients,
          isGroupSend,
          message: err instanceof Error ? err.message : "Upload failed",
        });
      })
      .finally(() => {
        void cleanupBackgroundTasks(tasksForCleanup);
      });
  } catch (err) {
    console.error("[Upload] Failed to prepare file for upload:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    applyFailedUploadSideEffects({
      recipients,
      isGroupSend,
      message: `Failed to prepare media: ${errorMessage}`,
    });
  }
}