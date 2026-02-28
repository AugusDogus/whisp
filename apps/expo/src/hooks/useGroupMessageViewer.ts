import { useCallback, useState } from "react";

import type { InboxMessage } from "~/components/friends/types";
import { trpc } from "~/utils/api";

interface GroupInboxItem {
  deliveryId: string;
  messageId: string;
  senderId: string;
  fileUrl: string;
  mimeType?: string;
  thumbhash?: string;
  createdAt: Date;
}

export function useGroupMessageViewer(groupId: string) {
  const utils = trpc.useUtils();
  const markRead = trpc.messages.markRead.useMutation({
    onSettled: () => {
      void utils.groups.inbox.invalidate({ groupId });
      void utils.groups.list.invalidate();
      void utils.messages.inbox.invalidate();
    },
  });
  const { mutate: cleanupMessage } =
    trpc.messages.cleanupIfAllRead.useMutation();

  const [viewer, setViewer] = useState<{
    friendId: string;
    queue: InboxMessage[];
    index: number;
  } | null>(null);

  const openViewer = useCallback(
    (messages: GroupInboxItem[], startIndex: number) => {
      if (messages.length === 0) return;
      const asInbox: InboxMessage[] = messages.map((m) => ({
        deliveryId: m.deliveryId,
        messageId: m.messageId,
        senderId: m.senderId,
        groupId: groupId,
        fileUrl: m.fileUrl,
        mimeType: m.mimeType,
        thumbhash: m.thumbhash,
        createdAt: m.createdAt,
      }));
      setViewer({ friendId: groupId, queue: asInbox, index: startIndex });
      const first = asInbox[startIndex];
      if (first?.deliveryId) {
        markRead.mutate({ deliveryId: first.deliveryId });
      }
    },
    [groupId, markRead],
  );

  const closeViewer = useCallback(() => {
    if (viewer) {
      const messageIds = new Set(
        viewer.queue
          .map((m) => m?.messageId)
          .filter((id): id is string => Boolean(id)),
      );
      for (const messageId of messageIds) {
        cleanupMessage({ messageId });
      }
    }
    setViewer(null);
  }, [cleanupMessage, viewer]);

  const onViewerTap = useCallback(() => {
    if (!viewer) return;
    const nextIndex = viewer.index + 1;
    if (nextIndex < viewer.queue.length) {
      setViewer({ ...viewer, index: nextIndex });
      const nextMsg = viewer.queue[nextIndex];
      if (nextMsg?.deliveryId) {
        markRead.mutate({ deliveryId: nextMsg.deliveryId });
      }
    } else {
      closeViewer();
    }
  }, [closeViewer, markRead, viewer]);

  return { viewer, openViewer, closeViewer, onViewerTap };
}
