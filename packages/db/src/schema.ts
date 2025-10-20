import { sqliteTable } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { user } from "./auth-schema";

export * from "./auth-schema";

// Friend relationships and messaging (ephemeral media)

// Push notification tokens for multiple devices
export const PushToken = sqliteTable("push_token", (t) => ({
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
}));

export const FriendRequest = sqliteTable("friend_request", (t) => ({
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
}));

export const Friendship = sqliteTable("friendship", (t) => ({
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
}));

export const Message = sqliteTable("message", (t) => ({
  id: t
    .text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  senderId: t.text().notNull(),
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
}));

export const MessageDelivery = sqliteTable("message_delivery", (t) => ({
  id: t
    .text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  messageId: t.text().notNull(),
  recipientId: t.text().notNull(),
  createdAt: t
    .integer({ mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
  readAt: t.integer({ mode: "timestamp" }),
}));

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
