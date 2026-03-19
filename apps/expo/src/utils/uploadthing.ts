import {
  createUploadthingBackgroundClient,
  listBackgroundUploadTasks,
  removeBackgroundUploadTask,
} from "react-native-uploadthing-background";

import type { UploadRouter } from "@acme/api";

import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";
import { compressImage, compressVideo } from "~/utils/media-compression";

export type { BackgroundUploadTask } from "react-native-uploadthing-background";

export function uploadthingFetch(input: RequestInfo | URL, init?: RequestInit) {
  const cookies = authClient.getCookie();
  const betterAuthHeaders = {
    Cookie: cookies,
  };

  return fetch(input, {
    ...(init as RequestInit),
    credentials: "include",
    headers: {
      ...init?.headers,
      ...betterAuthHeaders,
    },
  });
}

export const { uploadFilesWithInputInBackground } =
  createUploadthingBackgroundClient<UploadRouter>({
    url: getBaseUrl() + "/api/uploadthing",
    fetch: uploadthingFetch,
    notificationTitle: "Sending whisp",
    notificationBody: "Your media will keep uploading in the background.",
  });

export {
  listBackgroundUploadTasks,
  removeBackgroundUploadTask,
} from "react-native-uploadthing-background";

/**
 * Creates a File object from a URI with automatic compression
 * @param uri The file URI (can be with or without file:// prefix)
 * @param type The media type - "photo" or "video" - to determine compression method
 * @returns A File object ready for upload
 */
export const createFile = async (
  uri: string,
  type?: "photo" | "video",
): Promise<File> => {
  let processedUri = uri;

  // Apply compression if type is specified
  if (type === "photo") {
    processedUri = await compressImage(uri);
  } else if (type === "video") {
    processedUri = await compressVideo(uri);
  }

  // Avoid `expo-file-system`'s `File` constructor on iOS (can crash in validatePath).
  // This mirrors `@uploadthing/expo`'s approach: fetch the URI -> blob -> web File,
  // then attach `{ uri }` so React Native FormData can send it.
  const res = await fetch(processedUri);
  if (!res.ok) {
    throw new Error(
      `[Upload] Failed to read local file for upload (status ${res.status})`,
    );
  }
  const blob = await res.blob();

  // Keep this simple: our URIs are local `file://...` paths with no query/hash,
  // and we already know whether we're uploading a photo or video.
  const ext = type === "video" ? "mp4" : "jpg";
  const nameFromPath = processedUri.split("/").pop();
  const fileName =
    nameFromPath && nameFromPath.length > 0
      ? nameFromPath
      : `whisp-${Date.now()}.${ext}`;

  const file = new File([blob], fileName, {
    type: blob.type,
    lastModified: Date.now(),
  });

  const rnFormDataCompatibleFile = Object.assign(file, { uri: processedUri });
  return rnFormDataCompatibleFile;
};
