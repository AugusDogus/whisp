import type { db } from "@acme/db/client";

interface NotificationPayload {
  to: string; // Expo push token
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export async function sendPushNotification(payload: NotificationPayload) {
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

    const data = await response.json();
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

  return {
    success: true,
    sent: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length,
  };
}

export async function notifyNewMessage(
  database: typeof db,
  recipientId: string,
  senderId: string,
  senderName: string,
  messageId: string,
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
