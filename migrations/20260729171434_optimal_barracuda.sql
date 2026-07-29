DROP TABLE `external_token_lease`;--> statement-breakpoint
DROP TABLE `agent_access_request`;--> statement-breakpoint
CREATE TABLE `agent_access_request` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`agent_identity_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`scopes` text NOT NULL,
	`reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`approval_token_hash` text NOT NULL,
	`encrypted_approval_token` text NOT NULL,
	`grant_id` text,
	`expires_at` integer NOT NULL,
	`decided_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`connection_id`) REFERENCES `resource_account_connection`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`binding_id`) REFERENCES `agent_identity_binding`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_access_request_approval_token_hash_unique` ON `agent_access_request` (`approval_token_hash`);--> statement-breakpoint
CREATE INDEX `agentAccessRequest_resourceId_idx` ON `agent_access_request` (`resource_id`);--> statement-breakpoint
CREATE INDEX `agentAccessRequest_connectionId_idx` ON `agent_access_request` (`connection_id`);--> statement-breakpoint
CREATE INDEX `agentAccessRequest_agentIdentityId_idx` ON `agent_access_request` (`agent_identity_id`);--> statement-breakpoint
CREATE INDEX `agentAccessRequest_status_idx` ON `agent_access_request` (`status`);--> statement-breakpoint
CREATE INDEX `agentAccessRequest_expiresAt_idx` ON `agent_access_request` (`expires_at`);--> statement-breakpoint
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
