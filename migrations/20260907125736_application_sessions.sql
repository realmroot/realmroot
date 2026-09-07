CREATE TABLE `application_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_active_at` integer NOT NULL,
	`user_agent` text,
	`installation_id` text,
	`device_name` text,
	`device_platform` text,
	`legacy` integer DEFAULT false NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `application_session_owner_idx` ON `application_session` (`user_id`,`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_session_active_installation_idx` ON `application_session` (`user_id`,`client_id`,`installation_id`) WHERE "application_session"."installation_id" is not null and "application_session"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD `application_session_id` text REFERENCES application_session(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_applicationSessionId_idx` ON `oauth_refresh_token` (`application_session_id`);
--> statement-breakpoint
-- Existing tokens cannot be reliably grouped into installations. Preserve each
-- active login explicitly as unidentified instead of guessing from browser IDs.
INSERT INTO application_session (id, user_id, client_id, created_at, last_active_at, legacy)
SELECT id, user_id, client_id, coalesce(created_at, 0), coalesce(created_at, 0), 1
FROM oauth_refresh_token WHERE revoked IS NULL;
--> statement-breakpoint
UPDATE oauth_refresh_token SET application_session_id = id WHERE revoked IS NULL;
