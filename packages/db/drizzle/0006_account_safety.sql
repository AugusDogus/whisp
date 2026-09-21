CREATE TABLE `abuse_report` (
	`id` text PRIMARY KEY NOT NULL,
	`reporterId` text,
	`reportedUserId` text,
	`reason` text NOT NULL,
	`details` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`createdAt` integer NOT NULL,
	`reviewedAt` integer,
	FOREIGN KEY (`reporterId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reportedUserId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `abuse_report_status_createdAt_idx` ON `abuse_report` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `abuse_report_reporterId_createdAt_idx` ON `abuse_report` (`reporterId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `account_suspension` (
	`userId` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `content_policy_acceptance` (
	`userId` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`acceptedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_block` (
	`blockerId` text NOT NULL,
	`blockedId` text NOT NULL,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`blockerId`, `blockedId`),
	FOREIGN KEY (`blockerId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blockedId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_block_blockedId_idx` ON `user_block` (`blockedId`);