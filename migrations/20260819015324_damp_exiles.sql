CREATE TABLE `team` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`organization_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_organizationId_name_unique` ON `team` (`organization_id`,`name`);--> statement-breakpoint
CREATE INDEX `team_organizationId_idx` ON `team` (`organization_id`);--> statement-breakpoint
CREATE TABLE `team_member` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teamMember_teamId_userId_unique` ON `team_member` (`team_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `teamMember_userId_idx` ON `team_member` (`user_id`);--> statement-breakpoint
ALTER TABLE `session` ADD `active_team_id` text;--> statement-breakpoint
ALTER TABLE `application` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
UPDATE `application` SET `visibility` = 'public';--> statement-breakpoint
UPDATE `application`
SET `oidc_scopes` = json_insert(`oidc_scopes`, '$[#]', 'groups')
WHERE `oauth_client_id` IN (SELECT `client_id` FROM `oauth_client` WHERE `type` <> 'machine')
  AND NOT EXISTS (SELECT 1 FROM json_each(`application`.`oidc_scopes`) WHERE value = 'groups');--> statement-breakpoint
UPDATE `oauth_client`
SET `scopes` = json_insert(coalesce(`scopes`, '[]'), '$[#]', 'groups')
WHERE `type` <> 'machine'
  AND NOT EXISTS (SELECT 1 FROM json_each(coalesce(`oauth_client`.`scopes`, '[]')) WHERE value = 'groups');--> statement-breakpoint
ALTER TABLE `invitation` ADD `team_id` text;--> statement-breakpoint
CREATE TRIGGER `member_organization_access_cleanup`
AFTER DELETE ON `member`
FOR EACH ROW
BEGIN
	DELETE FROM `team_member`
	WHERE `user_id` = OLD.`user_id`
	  AND `team_id` IN (SELECT `id` FROM `team` WHERE `organization_id` = OLD.`organization_id`);
	UPDATE `oauth_refresh_token`
	SET `revoked` = cast(unixepoch('subsecond') * 1000 as integer)
	WHERE `user_id` = OLD.`user_id`
	  AND `revoked` IS NULL
	  AND `client_id` IN (
		SELECT `oauth_client_id`
		FROM `application`
		WHERE `owner_organization_id` = OLD.`organization_id` AND `visibility` = 'private'
	  );
	UPDATE `session`
	SET `active_organization_id` = NULL, `active_team_id` = NULL
	WHERE `user_id` = OLD.`user_id` AND `active_organization_id` = OLD.`organization_id`;
END;
