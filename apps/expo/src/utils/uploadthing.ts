import { generateReactNativeHelpers } from "@uploadthing/expo";

import type { UploadRouter } from "@acme/api";

import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";
import { compressImage, compressVideo } from "~/utils/media-compression";

export const {
  useImageUploader,
  useDocumentUploader,
  useUploadThing,
  uploadFiles,
} = generateReactNativeHelpers<UploadRouter>({
  /**
   * Your server url.
   * @default process.env.EXPO_PUBLIC_SERVER_URL
   * @remarks In dev we will also try to use Expo.debuggerHost
   */
  url: getBaseUrl() + "/api/uploadthing",
  fetch: (input, init) => {
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
  },
});

// Temporary wrapper to allow passing `input` until types catch up
type UploadFilesRoute = Parameters<typeof uploadFiles>[0];
type UploadFilesBaseParams = Parameters<typeof uploadFiles>[1];
type UploadFilesResult = ReturnType<typeof uploadFiles>;

export function uploadFilesWithInput<I = unknown>(
  route: UploadFilesRoute,
  params: UploadFilesBaseParams & { input: I },
): UploadFilesResult {
  // Cast params back to the base type; runtime still forwards `input`
  return uploadFiles(route, params as UploadFilesBaseParams);
}

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
  const fileName = nameFromPath && nameFromPath.length > 0
    ? nameFromPath
    : `whisp-${Date.now()}.${ext}`;

  const file = new File([blob], fileName, {
    type: blob.type,
    lastModified: Date.now(),
  });

  const rnFormDataCompatibleFile = Object.assign(file, { uri: processedUri });
  return rnFormDataCompatibleFile;
};
