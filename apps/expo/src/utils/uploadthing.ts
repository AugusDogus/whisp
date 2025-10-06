import { File as ExpoFile } from "expo-file-system";
import { generateReactNativeHelpers } from "@uploadthing/expo";

import type { UploadRouter } from "@acme/api";

import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";

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

type ExpoFileWithLastModified = ExpoFile & {
  lastModified: number;
};

export const createFile = (uri: string) => {
  const file = new ExpoFile(uri) as ExpoFileWithLastModified;
  file.lastModified = new Date().getTime();
  return file as File;
};
