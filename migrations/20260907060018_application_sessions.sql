CREATE TABLE `application_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_active_at` integer NOT NULL,
	`user_agent` text,
	`legacy` integer DEFAULT false NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `application_session_owner_idx` ON `application_session` (`user_id`,`client_id`);--> statement-breakpoint
CREATE TABLE `application_session_token` (
	`token_id` text PRIMARY KEY NOT NULL,
	`application_session_id` text NOT NULL,
	FOREIGN KEY (`token_id`) REFERENCES `oauth_refresh_token`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_session_id`) REFERENCES `application_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `application_session_token_session_idx` ON `application_session_token` (`application_session_id`);
--> statement-breakpoint
-- Existing tokens carry no rotation-family identity. Preserve each authorization
-- without guessing physical installations or merging independent logins via SSO.
INSERT INTO application_session (id, user_id, client_id, created_at, last_active_at, legacy, revoked_at)
SELECT id, user_id, client_id, created_at, created_at, 1, revoked FROM oauth_refresh_token;
--> statement-breakpoint
INSERT INTO application_session_token (token_id, application_session_id)
SELECT id, id FROM oauth_refresh_token;
