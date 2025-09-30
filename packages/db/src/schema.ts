import { sqliteTable } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const Post = sqliteTable("post", (t) => ({
  id: t
    .text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: t.text({ length: 256 }).notNull(),
  content: t.text().notNull(),
  createdAt: t
    .integer({ mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: t.integer({ mode: "timestamp" }).$onUpdateFn(() => new Date()),
}));

export const CreatePostSchema = createInsertSchema(Post, {
  title: z.string().max(256),
  content: z.string().max(256),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export * from "./auth-schema";
