import { useEffect, useRef } from "react";

import * as Notifications from "expo-notifications";

import type { InboxMessage } from "~/components/friends/types";

interface UseMessageFromNotificationParams {
  senderId: string | undefined;
  inboxLoading: boolean;
  viewerOpen: boolean;
  clearParams: () => void;
  openViewer: (messages: InboxMessage[]) => void;
  refetchInbox: () => Promise<{ data?: InboxMessage[] }>;
}

/** Push data is only a navigation hint. Fetch authenticated delivery metadata. */
export function useMessageFromNotification(
  params: UseMessageFromNotificationParams,
) {
  const { senderId, inboxLoading, viewerOpen } = params;
  const latest = useRef(params);
  latest.current = params;
  useEffect(() => {
    if (!senderId || viewerOpen || inboxLoading) return;
    let cancelled = false;
    void latest.current
      .refetchInbox()
      .then(({ data }) => {
        if (cancelled) return;
        const messages = (data ?? []).filter((m) => m?.senderId === senderId);
        if (messages.length) {
          void Notifications.dismissAllNotificationsAsync();
          latest.current.openViewer(messages);
        }
        latest.current.clearParams();
      })
      .catch(() => {
        if (!cancelled) latest.current.clearParams();
      });
    return () => {
      cancelled = true;
    };
  }, [senderId, inboxLoading, viewerOpen]);
}
