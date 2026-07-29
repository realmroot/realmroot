CREATE TABLE `__old_external_token_lease` AS SELECT * FROM `external_token_lease`;--> statement-breakpoint
DROP TABLE `external_token_lease`;--> statement-breakpoint
DROP TABLE `agent_access_token`;--> statement-breakpoint
DROP TABLE `agent_authority_approval`;--> statement-breakpoint
DROP TABLE `agent_authority_grant`;--> statement-breakpoint
CREATE TABLE `__new_agent_access_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`connection_id` text,
	`agent_identity_id` text NOT NULL,
	`scopes` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`granted_by_user_id` text NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`connection_id`) REFERENCES `resource_account_connection`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`granted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_agent_access_grant`("id", "resource_id", "connection_id", "agent_identity_id", "scopes", "mode", "status", "granted_by_user_id", "expires_at", "revoked_at", "created_at", "updated_at") SELECT "id", "resource_id", "connection_id", "agent_identity_id", "scopes", "mode", "status", "granted_by_user_id", "expires_at", "revoked_at", "created_at", "updated_at" FROM `agent_access_grant`;--> statement-breakpoint
DROP TABLE `agent_access_grant`;--> statement-breakpoint
ALTER TABLE `__new_agent_access_grant` RENAME TO `agent_access_grant`;--> statement-breakpoint
CREATE INDEX `agentAccessGrant_resourceId_idx` ON `agent_access_grant` (`resource_id`);--> statement-breakpoint
CREATE INDEX `agentAccessGrant_connectionId_idx` ON `agent_access_grant` (`connection_id`);--> statement-breakpoint
CREATE INDEX `agentAccessGrant_agentIdentityId_idx` ON `agent_access_grant` (`agent_identity_id`);--> statement-breakpoint
CREATE INDEX `agentAccessGrant_status_idx` ON `agent_access_grant` (`status`);--> statement-breakpoint
CREATE TABLE `__new_agent_access_request` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`connection_id` text,
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
);
--> statement-breakpoint
INSERT INTO `__new_agent_access_request`("id", "resource_id", "connection_id", "agent_identity_id", "binding_id", "scopes", "reason", "status", "approval_token_hash", "encrypted_approval_token", "grant_id", "expires_at", "decided_at", "created_at", "updated_at") SELECT "id", "resource_id", "connection_id", "agent_identity_id", "binding_id", "scopes", "reason", "status", "approval_token_hash", "encrypted_approval_token", "grant_id", "expires_at", "decided_at", "created_at", "updated_at" FROM `agent_access_request`;--> statement-breakpoint
DROP TABLE `agent_access_request`;--> statement-breakpoint
ALTER TABLE `__new_agent_access_request` RENAME TO `agent_access_request`;--> statement-breakpoint
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
	FOREIGN KEY (`binding_id`) REFERENCES `agent_identity_binding`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
INSERT INTO `external_token_lease` (
	`id`,
	`grant_id`,
	`request_id`,
	`binding_id`,
	`encrypted_access_token`,
	`token_hash`,
	`confirmation_jkt`,
	`scopes`,
	`expires_at`,
	`revoked_at`,
	`created_at`
) SELECT
	`id`,
	`grant_id`,
	`request_id`,
	`binding_id`,
	`encrypted_access_token`,
	`token_hash`,
	`confirmation_jkt`,
	`scopes`,
	`expires_at`,
	`revoked_at`,
	`created_at`
FROM `__old_external_token_lease`;--> statement-breakpoint
DROP TABLE `__old_external_token_lease`;--> statement-breakpoint
CREATE UNIQUE INDEX `external_token_lease_token_hash_unique` ON `external_token_lease` (`token_hash`);--> statement-breakpoint
CREATE INDEX `externalTokenLease_grantId_idx` ON `external_token_lease` (`grant_id`);--> statement-breakpoint
CREATE INDEX `externalTokenLease_bindingId_idx` ON `external_token_lease` (`binding_id`);--> statement-breakpoint
CREATE INDEX `externalTokenLease_expiresAt_idx` ON `external_token_lease` (`expires_at`);
