CREATE TABLE `mls_application_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`draftId` text NOT NULL,
	`conversationId` text NOT NULL,
	`deviceId` text NOT NULL,
	`epoch` integer NOT NULL,
	`ciphertextHash` text NOT NULL,
	`revision` integer,
	FOREIGN KEY (`conversationId`) REFERENCES `mls_conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deviceId`) REFERENCES `mls_device`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `mls_conversation` ADD `epoch` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Retained historical commit events reconstruct the actual MLS epoch.
UPDATE `mls_conversation` SET `epoch` = (
  SELECT count(*) FROM `mls_event`
  WHERE `mls_event`.`conversationId` = `mls_conversation`.`id`
    AND json_extract(`mls_event`.`entry`, '$.kind') = 'commit'
);
--> statement-breakpoint
-- Migration-owned trigger: older deployed servers still publish commits into
-- this DB. Every writer must advance the epoch, without a second network query.
CREATE TRIGGER `mls_event_epoch` AFTER INSERT ON `mls_event`
WHEN json_extract(NEW.`entry`, '$.kind') = 'commit'
BEGIN
  UPDATE `mls_conversation` SET `epoch` = `epoch` + 1 WHERE `id` = NEW.`conversationId`;
END;
