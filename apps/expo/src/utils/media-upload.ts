import type { QueryClient } from "@tanstack/react-query";

import { toast } from "sonner-native";

import type { FriendsListOutput } from "~/utils/api";
import { whispMediaKindKey, type MediaKind } from "~/utils/media-kind";
import {
  markWhispFailed,
  markWhispPending,
  markWhispSent,
  markWhispUploading,
} from "~/utils/outbox-status";

import { authClient } from "./auth";
import {
  enqueueNativeSend,
  listNativeSends,
  acknowledgeNativeSend,
} from "./native-send";

interface UploadMediaParams {
  queryClient: QueryClient;
  uri: string;
  type: "photo" | "video";
  recipients: string[];
  groupId?: string;
}

function invalidateUploadRelatedQueries(
  queryClient: QueryClient,
  isGroupSend: boolean,
  groupId?: string,
) {
  void queryClient.invalidateQueries({
    queryKey: [["friends", "list"]] as const,
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
  queryClient: QueryClient;
  recipients: string[];
  mediaKind: MediaKind;
  isGroupSend: boolean;
  groupId?: string;
}) {
  const { queryClient, recipients, mediaKind, isGroupSend, groupId } = params;

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
          };
        });
      },
    );
  }

  invalidateUploadRelatedQueries(queryClient, isGroupSend, groupId);
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

// Native jobs are the durable source of truth. JS only enqueues and observes.
const observed = new Map<string, string>();
export async function reconcileNativeSends(queryClient: QueryClient) {
  const cookie = authClient.getCookie();
  const jobs = await listNativeSends();
  if (cookie !== authClient.getCookie()) return;
  for (const job of jobs) {
    if (cookie !== authClient.getCookie()) return;
    // Restore known types before publishing inbox invalidations, including jobs
    // recovered after process death. This caches no keys or viewing permission.
    if (job.status !== "failed")
      queryClient.setQueryData(whispMediaKindKey(job.id), job.kind);
    const status = `${job.status}:${job.error ?? ""}`;
    if (observed.get(job.id) !== status) {
      if (job.status === "sent") {
        // Keep the pending row until the inbox includes the delivery. Clearing
        // it first briefly renders the empty "Tap to send" state for self-sends.
        // Refresh cached inactive inboxes too, so returning from camera is ready.
        await queryClient.invalidateQueries(
          { queryKey: [["messages", "inbox"]], refetchType: "all" },
          { throwOnError: true },
        );
        if (cookie !== authClient.getCookie()) return;
      }
      observed.set(job.id, status);
      const isGroupSend = Boolean(job.groupId);
      if (job.status === "sent")
        applySuccessfulUploadSideEffects({
          queryClient,
          recipients: job.recipients,
          mediaKind: job.kind,
          isGroupSend,
          groupId: job.groupId ?? undefined,
        });
      else if (job.status === "failed")
        applyFailedUploadSideEffects({
          recipients: job.recipients,
          isGroupSend,
          message: job.error ?? undefined,
        });
      else if (job.status === "blocked")
        toast.info(job.error ?? "This send is paused. Reopen Whisp to retry.");
    }
    if (job.status === "sent" || job.status === "failed")
      await acknowledgeNativeSend(job.id);
  }
  // A completed older send must not hide another queued send to the same person.
  for (const job of jobs) {
    if (cookie !== authClient.getCookie()) return;
    if ((job.status !== "uploading" && job.status !== "blocked") || job.groupId)
      continue;
    markWhispPending(
      job.recipients,
      job.status === "blocked"
        ? "blocked"
        : job.error
          ? "retrying"
          : "uploading",
      job.kind,
    );
  }
}
export async function uploadMedia(params: UploadMediaParams): Promise<void> {
  const isGroupSend = Boolean(params.groupId?.trim());
  const cookie = authClient.getCookie();
  try {
    if (!isGroupSend) markWhispUploading(params.recipients, params.type);
    const messageId = await enqueueNativeSend({
      ...params,
      groupId: params.groupId?.trim() || undefined,
    });
    if (cookie === authClient.getCookie())
      params.queryClient.setQueryData(
        whispMediaKindKey(messageId),
        params.type,
      );
  } catch (error) {
    applyFailedUploadSideEffects({
      recipients: params.recipients,
      isGroupSend,
      message:
        error instanceof Error
          ? error.message
          : "The whisp could not be queued. Retry sending.",
    });
  }
}
