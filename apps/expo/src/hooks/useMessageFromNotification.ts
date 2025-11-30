import { useEffect } from "react";
import * as Notifications from "expo-notifications";

import type { trpc } from "~/utils/api";

/**
 * Message Opening from Push Notifications - Expected Behavior
 * ============================================================
 *
 * When a user taps a push notification for a new message, we need to:
 * 1. Navigate to the Friends screen
 * 2. Open the message viewer automatically
 * 3. Mark the first message as read immediately
 * 4. Handle the case where message data is in the notification (instant viewing)
 * 5. Handle the case where we need to fetch the message from the server
 *
 * This hook manages the logic for opening messages when the app is launched
 * from a push notification or when a notification is tapped while the app is running.
 *
 * Expected behavior:
 * - If notification contains full message data (instant message), seed the cache
 * - If message is already in inbox, open it immediately
 * - If message is not in inbox, refetch once and try again
 * - Always mark the first message as read when opening the viewer
 * - Clear the notification parameter after handling to prevent re-triggering
 */

/**
 * Message structure from the inbox query
 * Note: tRPC returns an array that can contain null values
 */
type MessageFromSender = {
  deliveryId: string;
  messageId: string;
  senderId: string;
  fileUrl: string;
  mimeType: string | undefined;
  thumbhash: string | undefined;
  createdAt: Date;
} | null;

interface InstantMessage {
  messageId: string;
  senderId: string;
  fileUrl: string;
  mimeType: string;
  deliveryId: string;
  thumbhash?: string;
}

interface UseMessageFromNotificationParams {
  /** The sender ID from the push notification deep link */
  senderId: string | undefined;
  /** Optional instant message data included in the notification */
  instantMessage: InstantMessage | undefined;
  /** Current inbox messages */
  inbox: MessageFromSender[];
  /** Whether inbox is currently loading */
  inboxLoading: boolean;
  /** Whether message viewer is currently open */
  viewerOpen: boolean;
  /** tRPC utils for cache manipulation */
  utils: ReturnType<typeof trpc.useUtils>;
  /** Navigation function to clear parameters */
  clearParams: () => void;
  /** Function to open the message viewer */
  openViewer: (messages: MessageFromSender[]) => void;
  /** Mutation to mark a message as read */
  markAsRead: (deliveryId: string) => void;
  /** Function to refetch inbox */
  refetchInbox: () => Promise<{ data?: MessageFromSender[] }>;
}

/**
 * Hook to handle opening messages from push notifications
 *
 * This encapsulates the complex logic of:
 * - Seeding the cache with instant message data
 * - Finding messages in the current inbox
 * - Refetching if needed
 * - Opening the viewer
 * - Marking messages as read
 */
export function useMessageFromNotification(
  params: UseMessageFromNotificationParams,
) {
  const {
    senderId,
    instantMessage,
    inbox,
    inboxLoading,
    viewerOpen,
    utils,
    clearParams,
    openViewer,
    markAsRead,
    refetchInbox,
  } = params;

  useEffect(() => {
    // Guard: Only run if we have a sender ID and viewer is not already open
    if (!senderId || viewerOpen || inboxLoading) {
      return;
    }

    console.log("Deep link effect triggered:", {
      openMessageFromSender: senderId,
      hasInstantMessage: !!instantMessage,
      inboxLoading,
      inboxLength: inbox.length,
      viewerOpen,
    });

    // Step 1: If we have instant message data, seed the query cache
    // Expected: This allows instant viewing without waiting for network fetch
    if (instantMessage) {
      console.log(
        "Seeding inbox cache with instant message data (no fetch needed!)",
      );

      utils.messages.inbox.setData(undefined, (old) => {
        const instantMsg = {
          deliveryId: instantMessage.deliveryId,
          messageId: instantMessage.messageId,
          senderId: instantMessage.senderId,
          fileUrl: instantMessage.fileUrl,
          mimeType: instantMessage.mimeType,
          thumbhash: instantMessage.thumbhash,
          createdAt: new Date(),
        };

        // Add to existing inbox (or create new array)
        const updated = old ? [...old, instantMsg] : [instantMsg];
        return updated;
      });

      // Don't invalidate here! The markRead mutation will invalidate after marking
      // as read, ensuring we don't refetch and show the message as unread again.
      // This prevents race condition:
      // 1. Seed cache with instant message
      // 2. Invalidate (refetch starts)
      // 3. Open viewer & mark as read
      // 4. Refetch completes BEFORE markRead → message reappears as unread ❌
    }

    // Step 2: Check if we have messages from this sender in the current inbox
    const messagesFromSender = inbox.filter(
      (m) => m && m.senderId === senderId,
    );

    console.log("Checking for messages from sender:", {
      senderId,
      messagesCount: messagesFromSender.length,
      inboxSenders: inbox.map((m) => m?.senderId),
    });

    // Step 3a: If we have messages, open the viewer immediately
    if (messagesFromSender.length > 0) {
      console.log("Opening viewer for sender:", senderId);

      // Optimistically remove messages from inbox (they're now in viewer)
      utils.messages.inbox.setData(undefined, (old) =>
        old ? old.filter((m) => m && m.senderId !== senderId) : [],
      );

      // Clear all notifications when opening viewer
      void Notifications.dismissAllNotificationsAsync();

      // Open the message viewer
      openViewer(messagesFromSender);

      // Mark the first message as read immediately
      // Expected: This prevents the message from reappearing after closing
      const firstMessage = messagesFromSender[0];
      if (firstMessage?.deliveryId) {
        markAsRead(firstMessage.deliveryId);
      }

      // Clear the parameter so this doesn't trigger again
      clearParams();
    } else {
      // Step 3b: No messages found - might be a timing issue, refetch once
      console.log("No messages in current inbox, refetching...");

      refetchInbox()
        .then(({ data: freshInbox }) => {
          const freshMessages = (freshInbox ?? []).filter(
            (m) => m && m.senderId === senderId,
          );

          if (freshMessages.length > 0) {
            console.log("Found messages after refetch:", freshMessages.length);

            // Optimistically update the inbox
            utils.messages.inbox.setData(undefined, (old) =>
              old ? old.filter((m) => m && m.senderId !== senderId) : [],
            );

            void Notifications.dismissAllNotificationsAsync();

            openViewer(freshMessages);

            // Mark the first message as read immediately
            const firstMessage = freshMessages[0];
            if (firstMessage?.deliveryId) {
              markAsRead(firstMessage.deliveryId);
            }
          } else {
            console.log("Still no messages found after refetch");
          }

          clearParams();
        })
        .catch((error) => {
          console.error("Error refetching inbox:", error);
          clearParams();
        });
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senderId, instantMessage, inbox, inboxLoading, viewerOpen]);
}
