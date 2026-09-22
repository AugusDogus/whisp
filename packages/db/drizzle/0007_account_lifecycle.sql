CREATE TABLE `file_deletion` (
	`fileKey` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `abuse_enforcement` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`keyTag` text NOT NULL,
	`reason` text NOT NULL,
	`policyVersion` text NOT NULL,
	`necessity` text NOT NULL,
	`decidedAt` integer NOT NULL,
	`expiresAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `abuse_enforcement_fingerprint_unique` ON `abuse_enforcement` (`fingerprint`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_abuse_report` (
	`id` text PRIMARY KEY NOT NULL,
	`reporterId` text,
	`reportedUserId` text,
	`reason` text NOT NULL,
	`details` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`createdAt` integer NOT NULL,
	`reviewedAt` integer,
	FOREIGN KEY (`reporterId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reportedUserId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_abuse_report`("id", "reporterId", "reportedUserId", "reason", "details", "status", "createdAt", "reviewedAt") SELECT "id", "reporterId", "reportedUserId", "reason", "details", "status", "createdAt", "reviewedAt" FROM `abuse_report`;--> statement-breakpoint
DROP TABLE `abuse_report`;--> statement-breakpoint
ALTER TABLE `__new_abuse_report` RENAME TO `abuse_report`;--> statement-breakpoint
CREATE INDEX `abuse_report_status_createdAt_idx` ON `abuse_report` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `abuse_report_reporterId_createdAt_idx` ON `abuse_report` (`reporterId`,`createdAt`);--> statement-breakpoint
DELETE FROM `abuse_report` WHERE "reporterId" IS NULL OR "reportedUserId" IS NULL;--> statement-breakpoint
CREATE TABLE `__new_account_suspension` (
	`userId` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
 `enforcementId` text REFERENCES `abuse_enforcement`(`id`) ON DELETE cascade,
 `expiresAt` integer,
 FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_account_suspension` (`userId`,`createdAt`) SELECT `userId`,`createdAt` FROM `account_suspension`;--> statement-breakpoint
DROP TABLE `account_suspension`;--> statement-breakpoint
ALTER TABLE `__new_account_suspension` RENAME TO `account_suspension`;--> statement-breakpoint
DELETE FROM `friend_request` WHERE `fromUserId` NOT IN (SELECT id FROM `user`) OR `toUserId` NOT IN (SELECT id FROM `user`);--> statement-breakpoint
CREATE TABLE `__new_friend_request` (
	`id` text PRIMARY KEY NOT NULL,
	`fromUserId` text NOT NULL,
	`toUserId` text NOT NULL,
	`status` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
 FOREIGN KEY (`fromUserId`) REFERENCES `user`(`id`) ON DELETE cascade,
 FOREIGN KEY (`toUserId`) REFERENCES `user`(`id`) ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_friend_request` (`id`,`fromUserId`,`toUserId`,`status`,`createdAt`,`updatedAt`) SELECT `id`,`fromUserId`,`toUserId`,`status`,`createdAt`,`updatedAt` FROM `friend_request`;--> statement-breakpoint
DROP TABLE `friend_request`;--> statement-breakpoint
ALTER TABLE `__new_friend_request` RENAME TO `friend_request`;--> statement-breakpoint
CREATE INDEX `friend_request_fromUserId_toUserId_idx` ON `friend_request` (`fromUserId`,`toUserId`);--> statement-breakpoint
CREATE INDEX `friend_request_toUserId_status_idx` ON `friend_request` (`toUserId`,`status`);--> statement-breakpoint
DELETE FROM `friendship` WHERE `userIdA` NOT IN (SELECT id FROM `user`) OR `userIdB` NOT IN (SELECT id FROM `user`);--> statement-breakpoint
CREATE TABLE `__new_friendship` (
	`id` text PRIMARY KEY NOT NULL,
	`userIdA` text NOT NULL,
	`userIdB` text NOT NULL,
	`createdAt` integer NOT NULL,
	`currentStreak` integer DEFAULT 0 NOT NULL,
	`lastActivityTimestampA` integer,
	`lastActivityTimestampB` integer,
	`streakUpdatedAt` integer,
 FOREIGN KEY (`userIdA`) REFERENCES `user`(`id`) ON DELETE cascade,
 FOREIGN KEY (`userIdB`) REFERENCES `user`(`id`) ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_friendship` (`id`,`userIdA`,`userIdB`,`createdAt`,`currentStreak`,`lastActivityTimestampA`,`lastActivityTimestampB`,`streakUpdatedAt`) SELECT `id`,`userIdA`,`userIdB`,`createdAt`,`currentStreak`,`lastActivityTimestampA`,`lastActivityTimestampB`,`streakUpdatedAt` FROM `friendship`;--> statement-breakpoint
DROP TABLE `friendship`;--> statement-breakpoint
ALTER TABLE `__new_friendship` RENAME TO `friendship`;--> statement-breakpoint
CREATE INDEX `friendship_userIdA_userIdB_idx` ON `friendship` (`userIdA`,`userIdB`);--> statement-breakpoint
INSERT OR IGNORE INTO file_deletion (fileKey, createdAt) SELECT fileKey, unixepoch() FROM message WHERE fileKey IS NOT NULL AND (`senderId` NOT IN (SELECT id FROM `user`));--> statement-breakpoint
DELETE FROM `message` WHERE `senderId` NOT IN (SELECT id FROM `user`);--> statement-breakpoint
CREATE TABLE `__new_message` (
	`id` text PRIMARY KEY NOT NULL,
	`senderId` text NOT NULL,
	`groupId` text,
	`fileUrl` text NOT NULL,
	`fileKey` text,
	`mimeType` text,
	`thumbhash` text,
	`createdAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`groupId`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade,
 FOREIGN KEY (`senderId`) REFERENCES `user`(`id`) ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_message` (`id`,`senderId`,`groupId`,`fileUrl`,`fileKey`,`mimeType`,`thumbhash`,`createdAt`,`deletedAt`) SELECT `id`,`senderId`,`groupId`,`fileUrl`,`fileKey`,`mimeType`,`thumbhash`,`createdAt`,`deletedAt` FROM `message`;--> statement-breakpoint
DROP TABLE `message`;--> statement-breakpoint
ALTER TABLE `__new_message` RENAME TO `message`;--> statement-breakpoint
CREATE INDEX `message_senderId_idx` ON `message` (`senderId`);--> statement-breakpoint
CREATE INDEX `message_groupId_deletedAt_createdAt_idx` ON `message` (`groupId`,`deletedAt`,`createdAt`);--> statement-breakpoint
DELETE FROM `message_delivery` WHERE `messageId` NOT IN (SELECT id FROM `message`) OR `recipientId` NOT IN (SELECT id FROM `user`);--> statement-breakpoint
CREATE TABLE `__new_message_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`messageId` text NOT NULL,
	`recipientId` text NOT NULL,
	`groupId` text,
	`createdAt` integer NOT NULL,
	`readAt` integer,
	FOREIGN KEY (`groupId`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade,
 FOREIGN KEY (`messageId`) REFERENCES `message`(`id`) ON DELETE cascade,
 FOREIGN KEY (`recipientId`) REFERENCES `user`(`id`) ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_message_delivery` (`id`,`messageId`,`recipientId`,`groupId`,`createdAt`,`readAt`) SELECT `id`,`messageId`,`recipientId`,`groupId`,`createdAt`,`readAt` FROM `message_delivery`;--> statement-breakpoint
DROP TABLE `message_delivery`;--> statement-breakpoint
ALTER TABLE `__new_message_delivery` RENAME TO `message_delivery`;--> statement-breakpoint
CREATE INDEX `message_delivery_recipientId_readAt_idx` ON `message_delivery` (`recipientId`,`readAt`);--> statement-breakpoint
CREATE INDEX `message_delivery_messageId_readAt_idx` ON `message_delivery` (`messageId`,`readAt`);--> statement-breakpoint
CREATE INDEX `message_delivery_recipientId_groupId_readAt_idx` ON `message_delivery` (`recipientId`,`groupId`,`readAt`);--> statement-breakpoint
DELETE FROM `push_token` WHERE `userId` NOT IN (SELECT id FROM `user`);--> statement-breakpoint
CREATE TABLE `__new_push_token` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`token` text NOT NULL,
	`platform` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
	`sessionId` text,
 FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE cascade,
 FOREIGN KEY (`sessionId`) REFERENCES `session`(`id`) ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_push_token` (`id`,`userId`,`token`,`platform`,`createdAt`,`updatedAt`,`sessionId`) SELECT `id`,`userId`,`token`,`platform`,`createdAt`,`updatedAt`,`sessionId` FROM `push_token`;--> statement-breakpoint
DROP TABLE `push_token`;--> statement-breakpoint
ALTER TABLE `__new_push_token` RENAME TO `push_token`;--> statement-breakpoint
CREATE UNIQUE INDEX `push_token_token_unique` ON `push_token` (`token`);--> statement-breakpoint
CREATE INDEX `push_token_userId_idx` ON `push_token` (`userId`);--> statement-breakpoint
CREATE INDEX `push_token_sessionId_idx` ON `push_token` (`sessionId`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
