ALTER TABLE `file_deletion` ADD `lastAttemptAt` integer;
--> statement-breakpoint
-- drizzle-kit's Turso generator quotes expression indexes as column names.
CREATE INDEX `file_deletion_attempt_order_idx` ON `file_deletion` (coalesce("lastAttemptAt", "createdAt"), "createdAt", "fileKey");
