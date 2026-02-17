import { useCallback, useEffect, useState } from "react";
import { BackHandler } from "react-native";
import * as Notifications from "expo-notifications";

import type { InboxMessage } from "~/components/friends/types";
import type { trpc } from "~/utils/api";

export interface ViewerState {
  friendId: string;
  queue: InboxMessage[];
  index: number;
}

export function useMessageViewerState({
  inboxRaw,
  utils,
  markAsRead,
  cleanupMessage,
}: {
  inboxRaw: InboxMessage[];
  utils: ReturnType<typeof trpc.useUtils>;
  markAsRead: (deliveryId: string) => void;
  cleanupMessage: (input: { messageId: string }) => void;
}) {
  /**
   * Message Viewer State
   * ====================
   * Expected behavior:
   * - viewer holds the current message being viewed and the queue of messages
   * - When a message is opened, it's removed from inbox and added to viewer
   * - User taps to advance through messages in the queue
   * - When queue is exhausted, viewer closes automatically
   */
  const [viewer, setViewer] = useState<ViewerState | null>(null);

  /**
   * Filter Inbox to Exclude Messages in Viewer
   * ===========================================
   * Expected behavior:
   * - If viewer is open, filter out all messages in the viewer queue from inbox
   * - This prevents messages from reappearing during manual refresh
   * - Race condition protection: Even if server hasn't processed markRead yet,
   *   we won't show messages that are actively being viewed
   */
  const inbox = viewer
    ? inboxRaw.filter((msg) => {
        if (!msg) return true;
        // Exclude any message that's in the viewer queue
        return !viewer.queue.some(
          (viewerMsg) => viewerMsg?.deliveryId === msg.deliveryId,
        );
      })
    : inboxRaw;

  /**
   * Opens the message viewer for a specific friend
   * Expected behavior:
   * - Filters inbox to get all messages from this friend
   * - Removes those messages from inbox (optimistic update)
   * - Clears notifications
   * - Opens viewer with first message
   * - Marks first message as read immediately
   */
  const openViewer = useCallback(
    (friendId: string) => {
      const queue = inbox.filter((m) => m?.senderId === friendId);
      if (queue.length === 0) return;

      // Optimistically update the inbox to remove messages from this friend
      utils.messages.inbox.setData(undefined, (old) =>
        old ? old.filter((m) => m && m.senderId !== friendId) : [],
      );

      // Clear notifications when opening viewer
      void Notifications.dismissAllNotificationsAsync();

      setViewer({ friendId, queue, index: 0 });

      // Mark the first message as read immediately
      const firstMessage = queue[0];
      if (firstMessage?.deliveryId) {
        markAsRead(firstMessage.deliveryId);
      }
    },
    [inbox, markAsRead, utils],
  );

  /**
   * Opens the message viewer with a pre-filtered queue
   * Used by push notification handler to open messages directly
   */
  const openViewerWithQueue = useCallback((messages: InboxMessage[]) => {
    if (messages.length === 0) return;

    const senderId = messages[0]?.senderId;
    if (!senderId) return;

    setViewer({ friendId: senderId, queue: messages, index: 0 });
  }, []);

  const closeViewer = useCallback(() => {
    // Best-effort cleanup: once the viewer closes, delete any messages that are
    // now fully read (this includes deleting the underlying UploadThing file).
    //
    // This is intentionally done *after* viewing so the media URL isn't deleted
    // while the client is still loading it.
    if (viewer) {
      const messageIds = new Set<string>();
      for (const msg of viewer.queue) {
        if (msg?.messageId) messageIds.add(msg.messageId);
      }
      for (const messageId of messageIds) {
        cleanupMessage({ messageId });
      }
    }

    setViewer(null);
    // Clear any remaining notifications when closing viewer
    void Notifications.dismissAllNotificationsAsync();
  }, [cleanupMessage, viewer]);

  /**
   * Handles taps on the message viewer
   * Expected behavior:
   * - Advance to next message in queue
   * - Mark the new message as read immediately
   * - If no more messages in queue, close the viewer
   * - This creates a "story-style" viewing experience
   */
  const onViewerTap = useCallback(() => {
    if (!viewer) return;
    const nextIndex = viewer.index + 1;
    if (nextIndex < viewer.queue.length) {
      setViewer({ ...viewer, index: nextIndex });
      // Mark the next message as read when advancing
      const nextMessage = viewer.queue[nextIndex];
      if (nextMessage?.deliveryId) {
        markAsRead(nextMessage.deliveryId);
      }
    } else {
      closeViewer();
    }
  }, [closeViewer, markAsRead, viewer]);

  // Handle hardware back button when viewer is open
  useEffect(() => {
    if (!viewer) return;

    const onBackPress = () => {
      closeViewer();
      return true; // Prevent default behavior
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      onBackPress,
    );

    return () => backHandler.remove();
  }, [viewer, closeViewer]);

  /**
   * Sync Viewer Queue with Inbox - Expected Behavior
   * =================================================
   * When the inbox updates (e.g., after refetching or receiving new messages),
   * we need to check if the viewer should be updated with new messages.
   */
  useEffect(() => {
    if (!viewer || viewer.queue.length === 0) return;

    // Find all messages from the current friend in inbox
    const inboxMessages = inbox.filter(
      (m) => m && m.senderId === viewer.friendId,
    );

    // If inbox has more messages than viewer queue, someone sent multiple messages
    // Update the viewer queue to include all messages
    if (inboxMessages.length > viewer.queue.length) {
      console.log("Inbox has new messages, updating viewer queue");

      // Find the current message we're viewing
      const currentMessage = viewer.queue[viewer.index];
      const matchingIndex = currentMessage
        ? inboxMessages.findIndex(
            (m) => m?.messageId === currentMessage.messageId,
          )
        : 0;

      setViewer({
        ...viewer,
        queue: inboxMessages,
        index: matchingIndex >= 0 ? matchingIndex : viewer.index,
      });

      // Remove from inbox (already viewing)
      utils.messages.inbox.setData(undefined, (old) =>
        old ? old.filter((m) => m && m.senderId !== viewer.friendId) : [],
      );
    }
  }, [inbox, viewer, utils]);

  return {
    viewer,
    inbox,
    openViewer,
    openViewerWithQueue,
    closeViewer,
    onViewerTap,
  };
}
