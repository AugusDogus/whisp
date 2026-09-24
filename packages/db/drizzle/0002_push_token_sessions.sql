ALTER TABLE `push_token` ADD `sessionId` text REFERENCES session(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `push_token_sessionId_idx` ON `push_token` (`sessionId`);