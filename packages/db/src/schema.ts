import { index, sqliteTable } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { user } from "./auth-schema";

export * from "./auth-schema";

// Friend relationships and messaging (ephemeral media)

// Push notification tokens for multiple devices
export const PushToken = sqliteTable(
  "push_token",
  (t) => ({
    id: t
      .text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: t.text().notNull(),
    token: t.text().notNull().unique(),
    // platform: 'ios' | 'android' | 'web'
    platform: t.text().notNull(),
    createdAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: t.integer({ mode: "timestamp" }).$onUpdateFn(() => new Date()),
  }),
  (table) => [index("push_token_userId_idx").on(table.userId)],
);

export const FriendRequest = sqliteTable(
  "friend_request",
  (t) => ({
    id: t
      .text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    fromUserId: t.text().notNull(),
    toUserId: t.text().notNull(),
    // status: 'pending' | 'accepted' | 'declined' | 'cancelled'
    status: t.text().notNull(),
    createdAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: t.integer({ mode: "timestamp" }).$onUpdateFn(() => new Date()),
  }),
  (table) => [
    index("friend_request_fromUserId_toUserId_idx").on(
      table.fromUserId,
      table.toUserId,
    ),
    index("friend_request_toUserId_status_idx").on(
      table.toUserId,
      table.status,
    ),
  ],
);

export const Friendship = sqliteTable(
  "friendship",
  (t) => ({
    id: t
      .text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Store a normalized pair (lexicographically sorted in app code)
    userIdA: t.text().notNull(),
    userIdB: t.text().notNull(),
    createdAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    // Streak tracking - counts consecutive UTC days where both users send
    currentStreak: t.integer().notNull().default(0),
    lastActivityTimestampA: t.integer({ mode: "timestamp" }), // Full timestamp for userA's last activity
    lastActivityTimestampB: t.integer({ mode: "timestamp" }), // Full timestamp for userB's last activity
    streakUpdatedAt: t.integer({ mode: "timestamp" }),
  }),
  (table) => [
    index("friendship_userIdA_userIdB_idx").on(table.userIdA, table.userIdB),
  ],
);

export const Group = sqliteTable("group", (t) => ({
  id: t
    .text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: t.text().notNull(),
  createdById: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: t
    .integer({ mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
}));

export const GroupMember = sqliteTable(
  "group_member",
  (t) => ({
    id: t
      .text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: t
      .text()
      .notNull()
      .references(() => Group.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    joinedAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (table) => [
    index("group_member_groupId_userId_idx").on(table.groupId, table.userId),
    index("group_member_userId_idx").on(table.userId),
  ],
);

export const Message = sqliteTable(
  "message",
  (t) => ({
    id: t
      .text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    senderId: t.text().notNull(),
    groupId: t.text().references(() => Group.id, { onDelete: "cascade" }),
    fileUrl: t.text().notNull(),
    // Store UploadThing file key for deletion when all recipients have read
    fileKey: t.text(),
    mimeType: t.text(),
    // Store base64-encoded thumbhash for image/video preview
    thumbhash: t.text(),
    createdAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    deletedAt: t.integer({ mode: "timestamp" }),
  }),
  (table) => [
    index("message_senderId_idx").on(table.senderId),
    index("message_groupId_deletedAt_createdAt_idx").on(
      table.groupId,
      table.deletedAt,
      table.createdAt,
    ),
  ],
);

export const MessageDelivery = sqliteTable(
  "message_delivery",
  (t) => ({
    id: t
      .text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    messageId: t.text().notNull(),
    recipientId: t.text().notNull(),
    groupId: t.text().references(() => Group.id, { onDelete: "cascade" }),
    createdAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    readAt: t.integer({ mode: "timestamp" }),
  }),
  (table) => [
    index("message_delivery_recipientId_readAt_idx").on(
      table.recipientId,
      table.readAt,
    ),
    index("message_delivery_messageId_readAt_idx").on(
      table.messageId,
      table.readAt,
    ),
    index("message_delivery_recipientId_groupId_readAt_idx").on(
      table.recipientId,
      table.groupId,
      table.readAt,
    ),
  ],
);

export const BackgroundUploadTestFile = sqliteTable(
  "background_upload_test_file",
  (t) => ({
    id: t
      .text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fileKey: t.text().notNull().unique(),
    fileUrl: t.text().notNull(),
    originalFileName: t.text().notNull(),
    mimeType: t.text(),
    createdAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (table) => [
    index("background_upload_test_file_userId_createdAt_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const CreateFriendRequestSchema = createInsertSchema(FriendRequest, {
  status: z
    .enum(["pending", "accepted", "declined", "cancelled"])
    .default("pending"),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const CreateMessageSchema = createInsertSchema(Message).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
});

// Waitlist for landing page
export const Waitlist = sqliteTable("waitlist", (t) => ({
  id: t
    .text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: t
    .text()
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: t
    .integer({ mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
}));
