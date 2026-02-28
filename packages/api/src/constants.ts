export const DISCORD_PROVIDER_ID = "discord";

export const FRIEND_REQUEST_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  CANCELLED: "cancelled",
} as const;

export const NOTIFICATION_TYPE = {
  MESSAGE: "message",
  FRIEND_REQUEST: "friend_request",
  FRIEND_ACCEPT: "friend_accept",
} as const;

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
