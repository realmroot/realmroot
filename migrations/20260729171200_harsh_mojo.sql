DROP TABLE `external_token_lease`;--> statement-breakpoint
CREATE TABLE `external_token_lease` (
	`id` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`request_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`encrypted_access_token` text NOT NULL,
	`token_hash` text NOT NULL,
	`confirmation_jkt` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`grant_id`) REFERENCES `agent_access_grant`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`request_id`) REFERENCES `agent_access_request`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`binding_id`) REFERENCES `agent_identity_binding`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `external_token_lease_token_hash_unique` ON `external_token_lease` (`token_hash`);--> statement-breakpoint
CREATE INDEX `externalTokenLease_grantId_idx` ON `external_token_lease` (`grant_id`);--> statement-breakpoint
CREATE INDEX `externalTokenLease_expiresAt_idx` ON `external_token_lease` (`expires_at`);--> statement-breakpoint
CREATE INDEX `externalTokenLease_bindingId_idx` ON `external_token_lease` (`binding_id`);
