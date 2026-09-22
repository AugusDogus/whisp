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

// Pseudonymous personal data. Only a confirmed, individually justified decision
// may create this record. It intentionally has no user/report foreign key.
export const AbuseEnforcement = sqliteTable("abuse_enforcement", (t) => ({
  id: t
    .text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  fingerprint: t.text().notNull().unique(),
  keyTag: t.text().notNull(),
  reason: t
    .text({
      enum: [
        "child_safety",
        "credible_threat",
        "nonconsensual_intimate_content",
        "repeated_severe_harassment",
      ],
    })
    .notNull(),
  policyVersion: t.text().notNull(),
  // Structured human finding, never copied report text or Discord/profile data.
  necessity: t.text({ enum: ["likely_serious_abuse_on_return"] }).notNull(),
  decidedAt: t.integer({ mode: "timestamp" }).notNull(),
  expiresAt: t.integer({ mode: "timestamp" }).notNull(),
}));

export const AccountSuspension = sqliteTable("account_suspension", (t) => ({
  enforcementId: t
    .text()
    .references(() => AbuseEnforcement.id, { onDelete: "cascade" }),
  // Null only for pre-migration account-local suspensions.
  expiresAt: t.integer({ mode: "timestamp" }),
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
    reporterId: t.text().references(() => user.id, { onDelete: "cascade" }),
    reportedUserId: t.text().references(() => user.id, { onDelete: "cascade" }),
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
