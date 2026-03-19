import type {
  BackgroundUploadHeader,
  BackgroundUploadTask,
  UploadthingBackground,
} from "./specs/uploadthing-background.nitro";
import type { FileRouter } from "uploadthing/types";

import { NitroModules } from "react-native-nitro-modules";

import { version as uploadthingVersion } from "uploadthing/client";

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_MAX_WAIT_MS = 10 * 60 * 1_000;
const PACKAGE_NAME = "react-native-uploadthing-background";
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

type CompatibleUploadFile = File & { uri?: string };

interface UploadthingPresignedUpload {
  url: string;
  key: string;
  name: string;
  customId?: string | null;
}

interface CreateUploadthingBackgroundClientOptions {
  url: string | URL;
  fetch?: typeof globalThis.fetch;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  notificationTitle?: string;
  notificationBody?: string;
}

interface UploadFilesWithInputParams<TInput> {
  files: CompatibleUploadFile[];
  input?: TInput;
  notificationTitle?: string;
  notificationBody?: string;
}

interface UploadFilesWithInputResult {
  tasks: BackgroundUploadTask[];
  completion: Promise<BackgroundUploadTask[]>;
}

type HeaderInput = Record<string, string> | Array<[string, string]> | undefined;

let uploadthingBackground: UploadthingBackground | null = null;

function getUploadthingBackground(): UploadthingBackground {
  if (uploadthingBackground != null) {
    return uploadthingBackground;
  }

  uploadthingBackground =
    NitroModules.createHybridObject<UploadthingBackground>(
      "UploadthingBackground",
    );

  return uploadthingBackground;
}

function createTaskId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `utbg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTerminalTask(
  task: BackgroundUploadTask | null,
): task is BackgroundUploadTask {
  return (
    task != null &&
    TERMINAL_STATUSES.has(
      task.status as typeof TERMINAL_STATUSES extends Set<infer T> ? T : never,
    )
  );
}

function ensureFileUri(file: CompatibleUploadFile): string {
  if (typeof file.uri === "string" && file.uri.length > 0) {
    return file.uri;
  }

  throw new Error(
    "Background UploadThing uploads require React Native FormData-compatible files with a local `uri`.",
  );
}

function normalizeHeaders(headers: HeaderInput): BackgroundUploadHeader[] {
  if (!headers) return [];

  if (Array.isArray(headers)) {
    return headers.map(([key, value]) => ({
      key,
      value,
    }));
  }

  return Object.entries(headers).map(([key, value]) => ({
    key,
    value,
  }));
}

function resolveFetch(
  fetchImpl: typeof globalThis.fetch | undefined,
): typeof globalThis.fetch {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (typeof resolved !== "function") {
    throw new Error("No fetch implementation is available for UploadThing.");
  }
  return resolved;
}

async function requestUploadTargets<TInput>(
  url: string | URL,
  route: string,
  files: CompatibleUploadFile[],
  input: TInput | undefined,
  fetchImpl: typeof globalThis.fetch,
): Promise<UploadthingPresignedUpload[]> {
  const requestUrl = new URL(url.toString());
  requestUrl.searchParams.set("actionType", "upload");
  requestUrl.searchParams.set("slug", route);

  const response = await fetchImpl(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-uploadthing-package": PACKAGE_NAME,
      "x-uploadthing-version": uploadthingVersion,
    },
    body: JSON.stringify({
      files: files.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      })),
      input: input ?? null,
    }),
  });

  const text = await response.text();
  const payload = text.length > 0 ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload != null &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : `UploadThing request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (!Array.isArray(payload)) {
    throw new Error("UploadThing did not return a valid upload target list.");
  }

  return payload as UploadthingPresignedUpload[];
}

export async function waitForBackgroundUploadTask(
  taskId: string,
  options?: { pollIntervalMs?: number; maxWaitMs?: number },
): Promise<BackgroundUploadTask> {
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxWaitMs = options?.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const startedAt = Date.now();

  // eslint-disable-next-line no-constant-condition -- intentional polling loop
  while (true) {
    const task = await getUploadthingBackground().getTask(taskId);
    if (task == null) {
      throw new Error(
        `Background upload task "${taskId}" was removed before it reached a terminal state.`,
      );
    }
    if (isTerminalTask(task)) {
      const observedTask =
        await getUploadthingBackground().markTaskObserved(taskId);
      return observedTask ?? task;
    }
    if (Date.now() - startedAt >= maxWaitMs) {
      throw new Error(
        `Timed out while waiting for background upload task "${taskId}".`,
      );
    }
    await sleep(pollIntervalMs);
  }
}

export async function waitForBackgroundUploadTasks(
  taskIds: string[],
  options?: { pollIntervalMs?: number; maxWaitMs?: number },
): Promise<BackgroundUploadTask[]> {
  return Promise.all(
    taskIds.map((taskId) => waitForBackgroundUploadTask(taskId, options)),
  );
}

export function createUploadthingBackgroundClient<TRouter extends FileRouter>(
  options: CreateUploadthingBackgroundClientOptions,
) {
  const fetchImpl = resolveFetch(options.fetch);

  async function uploadFilesWithInputInBackground<
    TEndpoint extends keyof TRouter & string,
    TInput = unknown,
  >(
    route: TEndpoint,
    params: UploadFilesWithInputParams<TInput>,
  ): Promise<UploadFilesWithInputResult> {
    const uploadTargets = await requestUploadTargets(
      options.url,
      route,
      params.files,
      params.input,
      fetchImpl,
    );

    if (uploadTargets.length !== params.files.length) {
      throw new Error(
        "UploadThing returned an unexpected number of upload targets.",
      );
    }

    const tasks: BackgroundUploadTask[] = [];

    try {
      for (const [index, file] of params.files.entries()) {
        const uploadTarget = uploadTargets[index];
        if (!uploadTarget) {
          throw new Error("Missing upload target for file.");
        }

        const task = await getUploadthingBackground().enqueueUpload({
          taskId: createTaskId(),
          url: uploadTarget.url,
          method: "PUT",
          fileUri: ensureFileUri(file),
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          headers: normalizeHeaders(undefined),
          notificationTitle:
            params.notificationTitle ?? options.notificationTitle,
          notificationBody: params.notificationBody ?? options.notificationBody,
        });
        tasks.push(task);
      }
    } catch (error) {
      await Promise.allSettled(
        tasks.map(async (task) => {
          await getUploadthingBackground().cancelUpload(task.taskId);
          await getUploadthingBackground().removeTask(task.taskId);
        }),
      );
      throw error instanceof Error
        ? error
        : new Error("Failed to enqueue background upload tasks.");
    }

    return {
      tasks,
      completion: waitForBackgroundUploadTasks(
        tasks.map((task) => task.taskId),
        {
          pollIntervalMs: options.pollIntervalMs,
          maxWaitMs: options.maxWaitMs,
        },
      ),
    };
  }

  return {
    uploadFilesWithInputInBackground,
  };
}
