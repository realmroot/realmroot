CREATE TABLE `agent_access_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`connection_id` text NOT NULL,
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
CREATE INDEX `agentAccessGrant_resourceId_idx` ON `agent_access_grant` (`resource_id`);--> statement-breakpoint
CREATE INDEX `agentAccessGrant_connectionId_idx` ON `agent_access_grant` (`connection_id`);--> statement-breakpoint
CREATE INDEX `agentAccessGrant_agentIdentityId_idx` ON `agent_access_grant` (`agent_identity_id`);--> statement-breakpoint
CREATE INDEX `agentAccessGrant_status_idx` ON `agent_access_grant` (`status`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `agent_access_request_approval_token_hash_unique` ON `agent_access_request` (`approval_token_hash`);--> statement-breakpoint
CREATE INDEX `agentAccessRequest_resourceId_idx` ON `agent_access_request` (`resource_id`);--> statement-breakpoint
CREATE INDEX `agentAccessRequest_connectionId_idx` ON `agent_access_request` (`connection_id`);--> statement-breakpoint
CREATE INDEX `agentAccessRequest_agentIdentityId_idx` ON `agent_access_request` (`agent_identity_id`);--> statement-breakpoint
CREATE INDEX `agentAccessRequest_status_idx` ON `agent_access_request` (`status`);--> statement-breakpoint
CREATE INDEX `agentAccessRequest_expiresAt_idx` ON `agent_access_request` (`expires_at`);--> statement-breakpoint
CREATE TABLE `external_resource_authorization` (
	`resource_id` text PRIMARY KEY NOT NULL,
	`resource_url` text NOT NULL,
	`issuer` text NOT NULL,
	`authorization_endpoint` text NOT NULL,
	`token_endpoint` text NOT NULL,
	`registration_endpoint` text,
	`revocation_endpoint` text NOT NULL,
	`jwks_uri` text NOT NULL,
	`userinfo_endpoint` text,
	`registration_mode` text NOT NULL,
	`client_id` text NOT NULL,
	`encrypted_client_secret` text NOT NULL,
	`encrypted_registration_access_token` text,
	`scopes_supported` text NOT NULL,
	`metadata` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `external_token_lease` (
	`id` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`request_id` text NOT NULL,
	`encrypted_access_token` text NOT NULL,
	`token_hash` text NOT NULL,
	`confirmation_jkt` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`grant_id`) REFERENCES `agent_access_grant`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`request_id`) REFERENCES `agent_access_request`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_token_lease_token_hash_unique` ON `external_token_lease` (`token_hash`);--> statement-breakpoint
CREATE INDEX `externalTokenLease_grantId_idx` ON `external_token_lease` (`grant_id`);--> statement-breakpoint
CREATE INDEX `externalTokenLease_expiresAt_idx` ON `external_token_lease` (`expires_at`);--> statement-breakpoint
CREATE TABLE `resource_account_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`owner_user_id` text,
	`owner_organization_id` text,
	`external_subject` text NOT NULL,
	`display_name` text NOT NULL,
	`encrypted_tokens` text NOT NULL,
	`granted_scopes` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`credential_expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "resourceAccountConnection_exactly_one_owner_check" CHECK((("resource_account_connection"."owner_user_id" IS NOT NULL) + ("resource_account_connection"."owner_organization_id" IS NOT NULL)) = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resourceAccountConnection_resource_subject_owner_unique` ON `resource_account_connection` (`resource_id`,`external_subject`,`owner_user_id`,`owner_organization_id`);--> statement-breakpoint
CREATE INDEX `resourceAccountConnection_resourceId_idx` ON `resource_account_connection` (`resource_id`);--> statement-breakpoint
CREATE INDEX `resourceAccountConnection_ownerUserId_idx` ON `resource_account_connection` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `resourceAccountConnection_ownerOrganizationId_idx` ON `resource_account_connection` (`owner_organization_id`);--> statement-breakpoint
CREATE INDEX `resourceAccountConnection_status_idx` ON `resource_account_connection` (`status`);--> statement-breakpoint
CREATE TABLE `resource_connection_intent` (
	`id` text PRIMARY KEY NOT NULL,
	`state_hash` text NOT NULL,
	`resource_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`owner_organization_id` text,
	`scopes` text NOT NULL,
	`encrypted_pkce_verifier` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_connection_intent_state_hash_unique` ON `resource_connection_intent` (`state_hash`);--> statement-breakpoint
CREATE INDEX `resourceConnectionIntent_resourceId_idx` ON `resource_connection_intent` (`resource_id`);--> statement-breakpoint
CREATE INDEX `resourceConnectionIntent_ownerUserId_idx` ON `resource_connection_intent` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `resourceConnectionIntent_status_idx` ON `resource_connection_intent` (`status`);--> statement-breakpoint
CREATE INDEX `resourceConnectionIntent_expiresAt_idx` ON `resource_connection_intent` (`expires_at`);--> statement-breakpoint
DROP TABLE `external_account`;--> statement-breakpoint
DROP TABLE `external_account_grant`;--> statement-breakpoint
DROP TABLE `external_credential`;--> statement-breakpoint
DROP TABLE `external_oauth_intent`;--> statement-breakpoint
DROP INDEX `agentAuditEvent_externalAccountId_idx`;--> statement-breakpoint
ALTER TABLE `agent_audit_event` ADD `resource_id` text;--> statement-breakpoint
ALTER TABLE `agent_audit_event` ADD `resource_connection_id` text;--> statement-breakpoint
ALTER TABLE `agent_audit_event` ADD `access_grant_id` text;--> statement-breakpoint
ALTER TABLE `agent_audit_event` ADD `scopes` text;--> statement-breakpoint
CREATE INDEX `agentAuditEvent_resourceId_idx` ON `agent_audit_event` (`resource_id`);--> statement-breakpoint
ALTER TABLE `agent_audit_event` DROP COLUMN `external_account_id`;--> statement-breakpoint
ALTER TABLE `agent_audit_event` DROP COLUMN `external_account_grant_id`;--> statement-breakpoint
ALTER TABLE `agent_audit_event` DROP COLUMN `target_origin`;--> statement-breakpoint
ALTER TABLE `agent_audit_event` DROP COLUMN `target_path`;--> statement-breakpoint
ALTER TABLE `agent_audit_event` DROP COLUMN `method`;--> statement-breakpoint
ALTER TABLE `api_resource` ADD `authorization_mode` text DEFAULT 'flareauth' NOT NULL;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` DROP COLUMN `api_base_url`;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` DROP COLUMN `credential_modes`;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` DROP COLUMN `credential_header_name`;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` DROP COLUMN `allowed_methods`;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` DROP COLUMN `allowed_path_prefixes`;
