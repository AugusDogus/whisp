import { useEffect, useRef } from "react";

import * as Notifications from "expo-notifications";

import type { InboxMessage } from "~/components/friends/types";
import type { trpc } from "~/utils/api";

interface UseMessageFromNotificationParams {
  senderId: string | undefined;
  viewerOpen: boolean;
  utils: ReturnType<typeof trpc.useUtils>;
  clearParams: () => void;
  openViewer: (messages: InboxMessage[]) => void;
  markAsRead: (deliveryId: string) => void;
  refetchInbox: () => Promise<{ data?: InboxMessage[] }>;
}

// A notification is only a navigation hint. Fetch current deliveries before
// opening media: another device may have blocked the sender since it arrived.
export function useMessageFromNotification(
  params: UseMessageFromNotificationParams,
) {
  const latest = useRef(params);
  latest.current = params;
  const { senderId, viewerOpen } = params;
  useEffect(() => {
    if (!senderId || viewerOpen) return;
    let cancelled = false;
    async function open() {
      try {
        const { data } = await latest.current.refetchInbox();
        if (cancelled) return;
        const messages = (data ?? []).filter(
          (message) => message?.senderId === senderId,
        );
        const first = messages[0];
        if (first) {
          latest.current.utils.messages.inbox.setData(
            undefined,
            (old) =>
              old?.filter((message) => message?.senderId !== senderId) ?? [],
          );
          void Notifications.dismissAllNotificationsAsync();
          latest.current.openViewer(messages);
          latest.current.markAsRead(first.deliveryId);
        }
        latest.current.clearParams();
      } catch (error) {
        if (cancelled) return;
        console.warn(
          "Could not load the current inbox for this notification",
          error,
        );
        latest.current.clearParams();
      }
    }
    void open();
    return () => {
      cancelled = true;
    };
  }, [senderId, viewerOpen]);
}
