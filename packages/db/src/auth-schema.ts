import { sqliteTable } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", (t) => ({
  id: t.text().primaryKey(),
  name: t.text().notNull(),
  email: t.text().notNull().unique(),
  emailVerified: t.integer({ mode: "boolean" }).notNull(),
  image: t.text(),
  createdAt: t.integer({ mode: "timestamp" }).notNull(),
  updatedAt: t.integer({ mode: "timestamp" }).notNull(),
}));

export const session = sqliteTable("session", (t) => ({
  id: t.text().primaryKey(),
  expiresAt: t.integer({ mode: "timestamp" }).notNull(),
  token: t.text().notNull().unique(),
  createdAt: t.integer({ mode: "timestamp" }).notNull(),
  updatedAt: t.integer({ mode: "timestamp" }).notNull(),
  ipAddress: t.text(),
  userAgent: t.text(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
}));

export const account = sqliteTable("account", (t) => ({
  id: t.text().primaryKey(),
  accountId: t.text().notNull(),
  providerId: t.text().notNull(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: t.text(),
  refreshToken: t.text(),
  idToken: t.text(),
  accessTokenExpiresAt: t.integer({ mode: "timestamp" }),
  refreshTokenExpiresAt: t.integer({ mode: "timestamp" }),
  scope: t.text(),
  password: t.text(),
  createdAt: t.integer({ mode: "timestamp" }).notNull(),
  updatedAt: t.integer({ mode: "timestamp" }).notNull(),
}));

export const verification = sqliteTable("verification", (t) => ({
  id: t.text().primaryKey(),
  identifier: t.text().notNull(),
  value: t.text().notNull(),
  expiresAt: t.integer({ mode: "timestamp" }).notNull(),
  createdAt: t.integer({ mode: "timestamp" }),
  updatedAt: t.integer({ mode: "timestamp" }),
}));
