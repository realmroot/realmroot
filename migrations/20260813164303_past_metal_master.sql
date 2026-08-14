DROP TABLE `provider_connection_event_receipt`;--> statement-breakpoint
UPDATE `agent_access_request`
SET `connection_id` = NULL
WHERE `connection_id` IN (
	SELECT `provider_resource_authorization_id`
	FROM `provider_credential`
	WHERE `encrypted_tokens` IS NULL
);--> statement-breakpoint
UPDATE `resource_scope_entitlement`
SET `connection_id` = NULL
WHERE `connection_id` IN (
	SELECT `provider_resource_authorization_id`
	FROM `provider_credential`
	WHERE `encrypted_tokens` IS NULL
);--> statement-breakpoint
DELETE FROM `provider_resource_authorization`
WHERE `id` IN (
	SELECT `provider_resource_authorization_id`
	FROM `provider_credential`
	WHERE `encrypted_tokens` IS NULL
);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_provider_credential` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_resource_authorization_id` text NOT NULL,
	`external_subject` text NOT NULL,
	`display_name` text NOT NULL,
	`encrypted_tokens` text NOT NULL,
	`granted_scopes` text NOT NULL,
	`authorization_details` text DEFAULT '[]' NOT NULL,
	`authority_constraints` text DEFAULT '[]' NOT NULL,
	`client_generation` integer DEFAULT 1 NOT NULL,
	`credential_version` integer DEFAULT 1 NOT NULL,
	`refresh_claim_id` text,
	`refresh_claim_expires_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`credential_expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`provider_resource_authorization_id`) REFERENCES `provider_resource_authorization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_provider_credential`("id", "provider_resource_authorization_id", "external_subject", "display_name", "encrypted_tokens", "granted_scopes", "authorization_details", "authority_constraints", "client_generation", "credential_version", "refresh_claim_id", "refresh_claim_expires_at", "status", "credential_expires_at", "revoked_at", "created_at", "updated_at") SELECT "id", "provider_resource_authorization_id", "external_subject", "display_name", "encrypted_tokens", "granted_scopes", "authorization_details", "authority_constraints", "client_generation", "credential_version", "refresh_claim_id", "refresh_claim_expires_at", "status", "credential_expires_at", "revoked_at", "created_at", "updated_at" FROM `provider_credential`;--> statement-breakpoint
DROP TABLE `provider_credential`;--> statement-breakpoint
ALTER TABLE `__new_provider_credential` RENAME TO `provider_credential`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `providerCredential_authorization_unique` ON `provider_credential` (`provider_resource_authorization_id`);--> statement-breakpoint
CREATE INDEX `providerCredential_authorizationId_idx` ON `provider_credential` (`provider_resource_authorization_id`);--> statement-breakpoint
CREATE INDEX `providerCredential_status_idx` ON `provider_credential` (`status`);--> statement-breakpoint
ALTER TABLE `provider_resource_authorization` DROP COLUMN `provider_event_occurred_at`;--> statement-breakpoint
ALTER TABLE `provider_resource_authorization` DROP COLUMN `provider_event_revision`;--> statement-breakpoint
ALTER TABLE `resource_connection_intent` DROP COLUMN `authorization_mode`;
