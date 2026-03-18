import type { HybridObject } from "react-native-nitro-modules";

export type BackgroundUploadTaskStatus =
  | "queued"
  | "uploading"
  | "completed"
  | "failed"
  | "cancelled";

export interface BackgroundUploadHeader {
  key: string;
  value: string;
}

export interface BackgroundUploadRequest {
  taskId: string;
  url: string;
  method?: string;
  fileUri: string;
  fileName: string;
  mimeType: string;
  headers?: BackgroundUploadHeader[];
  notificationTitle?: string;
  notificationBody?: string;
}

export interface BackgroundUploadTask {
  taskId: string;
  status: BackgroundUploadTaskStatus;
  url: string;
  fileUri: string;
  fileName: string;
  mimeType: string;
  bytesSent: number;
  totalBytes: number;
  responseCode?: number;
  responseBody?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UploadthingBackground
  extends HybridObject<{ ios: "swift"; android: "kotlin" }> {
  readonly activeTaskCount: number;

  enqueueUpload(request: BackgroundUploadRequest): Promise<BackgroundUploadTask>;
  getTask(taskId: string): Promise<BackgroundUploadTask | null>;
  listTasks(): Promise<BackgroundUploadTask[]>;
  cancelUpload(taskId: string): Promise<void>;
  removeTask(taskId: string): Promise<void>;
}
