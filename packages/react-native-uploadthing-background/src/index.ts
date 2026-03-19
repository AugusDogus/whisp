import type {
  BackgroundUploadRequest,
  BackgroundUploadTask,
  UploadthingBackground,
} from "./specs/uploadthing-background.nitro";

import { NitroModules } from "react-native-nitro-modules";

export type {
  BackgroundUploadHeader,
  BackgroundUploadRequest,
  BackgroundUploadTask,
  BackgroundUploadTaskStatus,
  UploadthingBackground,
} from "./specs/uploadthing-background.nitro";
export * from "./uploadthing";

let uploadthingBackground: UploadthingBackground | null = null;

export function getUploadthingBackground(): UploadthingBackground {
  if (uploadthingBackground != null) {
    return uploadthingBackground;
  }

  uploadthingBackground =
    NitroModules.createHybridObject<UploadthingBackground>(
      "UploadthingBackground",
    );

  return uploadthingBackground;
}

export async function enqueueBackgroundUpload(
  request: BackgroundUploadRequest,
): Promise<BackgroundUploadTask> {
  return getUploadthingBackground().enqueueUpload(request);
}

export async function getBackgroundUploadTask(
  taskId: string,
): Promise<BackgroundUploadTask | null> {
  return getUploadthingBackground().getTask(taskId);
}

export async function listBackgroundUploadTasks(): Promise<
  BackgroundUploadTask[]
> {
  return getUploadthingBackground().listTasks();
}

export async function markBackgroundUploadTaskObserved(
  taskId: string,
): Promise<BackgroundUploadTask | null> {
  return getUploadthingBackground().markTaskObserved(taskId);
}

export async function cancelBackgroundUpload(taskId: string): Promise<void> {
  return getUploadthingBackground().cancelUpload(taskId);
}

export async function removeBackgroundUploadTask(
  taskId: string,
): Promise<void> {
  return getUploadthingBackground().removeTask(taskId);
}
