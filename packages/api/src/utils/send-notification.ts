import type { db } from "@acme/db/client";
import { eq } from "@acme/db";
import { PushToken } from "@acme/db/schema";

interface NotificationPayload {
  to: string; // Expo push token
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface PushNotificationResult {
  success: boolean;
  isInvalidToken?: boolean;
  data?: unknown;
  error?: unknown;
}

export async function sendPushNotification(
  payload: NotificationPayload,
): Promise<PushNotificationResult> {
  const message = {
    to: payload.to,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: payload.data,
  };

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    const data = (await response.json()) as {
      data?: { status?: string; details?: { error?: string } }[];
    };

    // Check if Expo rejected the token as invalid
    // Expo returns errors like "DeviceNotRegistered" or "InvalidCredentials"
    const firstResult = data.data?.[0];
    if (
      firstResult?.status === "error" &&
      (firstResult.details?.error === "DeviceNotRegistered" ||
        firstResult.details?.error === "InvalidCredentials")
    ) {
      console.log(`Invalid push token detected: ${payload.to}`);
      return { success: false, isInvalidToken: true, data };
    }

    return { success: true, data };
  } catch (error) {
    console.error("Error sending push notification:", error);
    return { success: false, error };
  }
}

export async function sendNotificationToUser(
  database: typeof db,
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
) {
  // Get all push tokens for this user
  const tokens = await database.query.PushToken.findMany({
    where: (tokens, { eq }) => eq(tokens.userId, userId),
  });

  if (tokens.length === 0) {
    console.log(`No push tokens found for user ${userId}`);
    return { success: false, reason: "no_tokens" };
  }

  // Send notification to all user's devices
  const results = await Promise.allSettled(
    tokens.map((token) =>
      sendPushNotification({
        to: token.token,
        title,
        body,
        data,
      }),
    ),
  );

  // Clean up invalid tokens
  const invalidTokens: string[] = [];
  results.forEach((result, index) => {
    if (
      result.status === "fulfilled" &&
      result.value.isInvalidToken &&
      tokens[index]
    ) {
      invalidTokens.push(tokens[index].token);
    }
  });

  if (invalidTokens.length > 0) {
    console.log(`Removing ${invalidTokens.length} invalid push tokens`);
    await Promise.all(
      invalidTokens.map((token) =>
        database.delete(PushToken).where(eq(PushToken.token, token)),
      ),
    );
  }

  return {
    success: true,
    sent: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length,
    invalidTokensRemoved: invalidTokens.length,
  };
}

export async function notifyNewMessage(
  database: typeof db,
  recipientId: string,
  senderId: string,
  senderName: string,
  messageId: string,
  fileUrl?: string,
  mimeType?: string,
  deliveryId?: string,
  thumbhash?: string,
) {
  // Check if user has message notifications enabled
  const recipient = await database.query.user.findFirst({
    where: (users, { eq }) => eq(users.id, recipientId),
    columns: {
      notifyOnMessages: true,
    },
  });

  if (!recipient?.notifyOnMessages) {
    console.log(`User ${recipientId} has message notifications disabled`);
    return { success: false, reason: "disabled" };
  }

  return sendNotificationToUser(
    database,
    recipientId,
    "New Whisper",
    `${senderName} sent you a whisper`,
    {
      type: "message",
      messageId,
      senderId,
      fileUrl,
      mimeType,
      deliveryId,
      thumbhash,
    },
  );
}

export async function notifyFriendRequest(
  database: typeof db,
  recipientId: string,
  senderName: string,
  requestId: string,
) {
  // Check if user has friend activity notifications enabled
  const recipient = await database.query.user.findFirst({
    where: (users, { eq }) => eq(users.id, recipientId),
    columns: {
      notifyOnFriendActivity: true,
    },
  });

  if (!recipient?.notifyOnFriendActivity) {
    console.log(
      `User ${recipientId} has friend activity notifications disabled`,
    );
    return { success: false, reason: "disabled" };
  }

  return sendNotificationToUser(
    database,
    recipientId,
    "New Friend Request",
    `${senderName} sent you a friend request`,
    {
      type: "friend_request",
      requestId,
    },
  );
}

export async function notifyFriendAccept(
  database: typeof db,
  recipientId: string,
  accepterName: string,
) {
  // Check if user has friend activity notifications enabled
  const recipient = await database.query.user.findFirst({
    where: (users, { eq }) => eq(users.id, recipientId),
    columns: {
      notifyOnFriendActivity: true,
    },
  });

  if (!recipient?.notifyOnFriendActivity) {
    console.log(
      `User ${recipientId} has friend activity notifications disabled`,
    );
    return { success: false, reason: "disabled" };
  }

  return sendNotificationToUser(
    database,
    recipientId,
    "Friend Request Accepted",
    `${accepterName} accepted your friend request`,
    {
      type: "friend_accept",
    },
  );
}
