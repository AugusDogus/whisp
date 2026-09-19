-- Earlier PR previews already received these tables through drizzle-kit push.
-- Adopt that schema without replacing encrypted conversations or delivery state.
CREATE TABLE IF NOT EXISTS `mls_conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`groupId` text,
	`users` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`members` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `mls_conversation_scope_unique` ON `mls_conversation` (`scope`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mls_device` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`signatureKey` text NOT NULL,
	`createdAt` integer NOT NULL,
	`revokedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mls_draft` (
	`id` text PRIMARY KEY NOT NULL,
	`senderId` text NOT NULL,
	`senderDeviceId` text NOT NULL,
	`groupId` text,
	`recipients` text NOT NULL,
	`conversationIds` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`completedAt` integer,
	`failure` text,
	FOREIGN KEY (`senderDeviceId`) REFERENCES `mls_device`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mls_draft_conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`draftId` text NOT NULL,
	`conversationId` text NOT NULL,
	`members` text NOT NULL,
	FOREIGN KEY (`draftId`) REFERENCES `mls_draft`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversationId`) REFERENCES `mls_conversation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mls_event` (
	`id` text PRIMARY KEY NOT NULL,
	`conversationId` text NOT NULL,
	`sequence` integer NOT NULL,
	`entry` text NOT NULL,
	FOREIGN KEY (`conversationId`) REFERENCES `mls_conversation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `mls_event_sequence_idx` ON `mls_event` (`conversationId`,`sequence`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mls_key_package` (
	`id` text PRIMARY KEY NOT NULL,
	`deviceId` text NOT NULL,
	`data` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`operationId` text,
	FOREIGN KEY (`deviceId`) REFERENCES `mls_device`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operationId`) REFERENCES `mls_operation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mls_key_package_device_idx` ON `mls_key_package` (`deviceId`,`operationId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mls_operation` (
	`id` text PRIMARY KEY NOT NULL,
	`conversationId` text NOT NULL,
	`deviceId` text NOT NULL,
	`baseRevision` integer NOT NULL,
	`revision` integer,
	`members` text NOT NULL,
	`expiresAt` integer NOT NULL,
	FOREIGN KEY (`conversationId`) REFERENCES `mls_conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deviceId`) REFERENCES `mls_device`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mls_welcome` (
	`keyPackageId` text PRIMARY KEY NOT NULL,
	`conversationId` text NOT NULL,
	`deviceId` text NOT NULL,
	`sequence` integer NOT NULL,
	`data` text NOT NULL,
	`members` text NOT NULL,
	`acknowledgedAt` integer,
	FOREIGN KEY (`keyPackageId`) REFERENCES `mls_key_package`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversationId`) REFERENCES `mls_conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deviceId`) REFERENCES `mls_device`(`id`) ON UPDATE no action ON DELETE cascade
);
