-- Adopt the existing db:push schema without replacing tables or data.
-- Future migrations are generated normally and tracked by Drizzle.
CREATE TABLE IF NOT EXISTS `background_upload_test_file` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`fileKey` text NOT NULL,
	`fileUrl` text NOT NULL,
	`originalFileName` text NOT NULL,
	`mimeType` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `background_upload_test_file_fileKey_unique` ON `background_upload_test_file` (`fileKey`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `background_upload_test_file_userId_createdAt_idx` ON `background_upload_test_file` (`userId`,`createdAt`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `friend_request` (
	`id` text PRIMARY KEY NOT NULL,
	`fromUserId` text NOT NULL,
	`toUserId` text NOT NULL,
	`status` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `friend_request_fromUserId_toUserId_idx` ON `friend_request` (`fromUserId`,`toUserId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `friend_request_toUserId_status_idx` ON `friend_request` (`toUserId`,`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `friendship` (
	`id` text PRIMARY KEY NOT NULL,
	`userIdA` text NOT NULL,
	`userIdB` text NOT NULL,
	`createdAt` integer NOT NULL,
	`currentStreak` integer DEFAULT 0 NOT NULL,
	`lastActivityTimestampA` integer,
	`lastActivityTimestampB` integer,
	`streakUpdatedAt` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `friendship_userIdA_userIdB_idx` ON `friendship` (`userIdA`,`userIdB`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `group` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`createdById` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `group_member` (
	`id` text PRIMARY KEY NOT NULL,
	`groupId` text NOT NULL,
	`userId` text NOT NULL,
	`joinedAt` integer NOT NULL,
	FOREIGN KEY (`groupId`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `group_member_groupId_userId_idx` ON `group_member` (`groupId`,`userId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `group_member_userId_idx` ON `group_member` (`userId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `message` (
	`id` text PRIMARY KEY NOT NULL,
	`senderId` text NOT NULL,
	`groupId` text,
	`fileUrl` text NOT NULL,
	`fileKey` text,
	`mimeType` text,
	`thumbhash` text,
	`createdAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`groupId`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `message_senderId_idx` ON `message` (`senderId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `message_groupId_deletedAt_createdAt_idx` ON `message` (`groupId`,`deletedAt`,`createdAt`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `message_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`messageId` text NOT NULL,
	`recipientId` text NOT NULL,
	`groupId` text,
	`createdAt` integer NOT NULL,
	`readAt` integer,
	FOREIGN KEY (`groupId`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `message_delivery_recipientId_readAt_idx` ON `message_delivery` (`recipientId`,`readAt`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `message_delivery_messageId_readAt_idx` ON `message_delivery` (`messageId`,`readAt`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `message_delivery_recipientId_groupId_readAt_idx` ON `message_delivery` (`recipientId`,`groupId`,`readAt`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `preview_push_token_reset` (
	`scope` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `preview_upload` (
	`fileKey` text PRIMARY KEY NOT NULL,
	`customId` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `preview_upload_control` (
	`scope` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `push_token` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`token` text NOT NULL,
	`platform` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `push_token_token_unique` ON `push_token` (`token`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `push_token_userId_idx` ON `push_token` (`userId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `waitlist` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `waitlist_userId_unique` ON `waitlist` (`userId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `account_userId_providerId_idx` ON `account` (`userId`,`providerId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `session_userId_idx` ON `session` (`userId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`discordUsername` text,
	`email` text NOT NULL,
	`emailVerified` integer NOT NULL,
	`image` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`notifyOnMessages` integer DEFAULT true NOT NULL,
	`notifyOnFriendActivity` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer,
	`updatedAt` integer
);
