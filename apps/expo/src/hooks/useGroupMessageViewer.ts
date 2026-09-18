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
    },
    [groupId],
  );

  const closeViewer = useCallback(() => {
    setViewer(null);
    void utils.groups.inbox.invalidate({ groupId });
    void utils.groups.list.invalidate();
    void utils.messages.inbox.invalidate();
  }, [utils, groupId]);

  const onViewerTap = useCallback(() => {
    if (!viewer) return;
    const nextIndex = viewer.index + 1;
    if (nextIndex < viewer.queue.length) {
      setViewer({ ...viewer, index: nextIndex });
    } else {
      closeViewer();
    }
  }, [closeViewer, viewer]);

  return { viewer, openViewer, closeViewer, onViewerTap };
}
