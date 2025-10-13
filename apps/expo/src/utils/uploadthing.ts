import { File as ExpoFile } from "expo-file-system";
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

type ExpoFileWithLastModified = ExpoFile & {
  lastModified: number;
};

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

  const file = new ExpoFile(processedUri) as ExpoFileWithLastModified;
  file.lastModified = new Date().getTime();
  return file as File;
};
