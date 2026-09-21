import { index, primaryKey, sqliteTable } from "drizzle-orm/sqlite-core";

import { user } from "./auth-schema";

export const UserBlock = sqliteTable(
  "user_block",
  (t) => ({
    blockerId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    blockedId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: t
      .integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  }),
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index("user_block_blockedId_idx").on(t.blockedId),
  ],
);

export const ContentPolicyAcceptance = sqliteTable(
  "content_policy_acceptance",
  (t) => ({
    userId: t
      .text()
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    version: t.text().notNull(),
    acceptedAt: t
      .integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  }),
);

export const AccountSuspension = sqliteTable("account_suspension", (t) => ({
  userId: t
    .text()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: t
    .integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
}));

// Reports contain account identifiers and the reporter's explanation, never media.
export const AbuseReport = sqliteTable(
  "abuse_report",
  (t) => ({
    id: t
      .text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    reporterId: t.text().references(() => user.id, { onDelete: "set null" }),
    reportedUserId: t
      .text()
      .references(() => user.id, { onDelete: "set null" }),
    reason: t
      .text({
        enum: [
          "spam",
          "harassment",
          "sexual_content",
          "child_safety",
          "violence",
          "other",
        ],
      })
      .notNull(),
    details: t.text().notNull(),
    status: t
      .text({ enum: ["pending", "dismissed", "actioned"] })
      .notNull()
      .default("pending"),
    createdAt: t
      .integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    reviewedAt: t.integer({ mode: "timestamp" }),
  }),
  (t) => [
    index("abuse_report_status_createdAt_idx").on(t.status, t.createdAt),
    index("abuse_report_reporterId_createdAt_idx").on(
      t.reporterId,
      t.createdAt,
    ),
  ],
);
