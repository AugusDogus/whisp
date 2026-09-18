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
}: {
  inboxRaw: InboxMessage[];
  utils: ReturnType<typeof trpc.useUtils>;
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
   * - Clears notifications
   * - Opens viewer with first message
   * - The viewer acknowledges only successfully displayed media
   */
  const openViewer = useCallback(
    (friendId: string) => {
      const queue = inbox.filter((m) => m?.senderId === friendId);
      if (queue.length === 0) return;

      // Clear notifications when opening viewer
      void Notifications.dismissAllNotificationsAsync();

      setViewer({ friendId, queue, index: 0 });
    },
    [inbox],
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
    setViewer(null);
    void utils.messages.inbox.invalidate();
    // Clear any remaining notifications when closing viewer
    void Notifications.dismissAllNotificationsAsync();
  }, [utils]);

  /**
   * Handles taps on the message viewer
   * Expected behavior:
   * - Advance to next message in queue
   * - Leave unread until the media is displayed
   * - If no more messages in queue, close the viewer
   * - This creates a "story-style" viewing experience
   */
  const onViewerTap = useCallback(() => {
    if (!viewer) return;
    const nextIndex = viewer.index + 1;
    if (nextIndex < viewer.queue.length) {
      setViewer({ ...viewer, index: nextIndex });
    } else {
      closeViewer();
    }
  }, [closeViewer, viewer]);

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

  return {
    viewer,
    inbox,
    openViewer,
    openViewerWithQueue,
    closeViewer,
    onViewerTap,
  };
}
