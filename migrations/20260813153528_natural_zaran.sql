PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_api_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`name` text NOT NULL,
	`resource_url` text NOT NULL,
	`authorization_model` text DEFAULT 'native' NOT NULL,
	`connector_id` text,
	`authorization_details` text DEFAULT '[]' NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`owner_organization_id` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`scope_registry` text,
	`available_to_agents` integer DEFAULT true NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`connector_id`) REFERENCES `identity_provider_connector`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_api_resource`("id", "identifier", "name", "resource_url", "authorization_model", "connector_id", "authorization_details", "description", "enabled", "owner_organization_id", "visibility", "scope_registry", "available_to_agents", "deleted_at", "created_at", "updated_at") SELECT "id", "identifier", "name", "resource_url", CASE WHEN "connector_id" IS NULL THEN 'native' ELSE 'external' END, "connector_id", "authorization_details", "description", "enabled", "owner_organization_id", "visibility", "scope_registry", "available_to_agents", "deleted_at", "created_at", "updated_at" FROM `api_resource`;--> statement-breakpoint
DROP TABLE `api_resource`;--> statement-breakpoint
ALTER TABLE `__new_api_resource` RENAME TO `api_resource`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `api_resource_identifier_unique` ON `api_resource` (`identifier`);--> statement-breakpoint
CREATE UNIQUE INDEX `apiResource_resourceUrl_unique` ON `api_resource` (`resource_url`);--> statement-breakpoint
CREATE INDEX `apiResource_enabled_idx` ON `api_resource` (`enabled`);--> statement-breakpoint
CREATE INDEX `apiResource_connectorId_idx` ON `api_resource` (`connector_id`);--> statement-breakpoint
CREATE INDEX `apiResource_ownerOrganizationId_idx` ON `api_resource` (`owner_organization_id`);--> statement-breakpoint
CREATE INDEX `apiResource_deletedAt_idx` ON `api_resource` (`deleted_at`);--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_authorization_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_client_id` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_client_secret` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_client_secret_context` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_issuer` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_authorization_endpoint` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_token_endpoint` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_user_info_endpoint` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_jwks_endpoint` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_registration_endpoint` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_revocation_endpoint` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_registration_mode` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_registration_client_uri` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_registration_access_token` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_registration_access_token_context` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_registered_scopes` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_client_generation` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_retired_client_generations` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `resource_provider_metadata` text;--> statement-breakpoint
UPDATE `identity_provider_connector`
SET `resource_authorization_enabled` = true,
    `resource_client_id` = `client_id`,
    `resource_client_secret` = `client_secret`,
    `resource_client_secret_context` = `client_secret_context`,
    `resource_issuer` = `issuer`,
    `resource_authorization_endpoint` = `authorization_endpoint`,
    `resource_token_endpoint` = `token_endpoint`,
    `resource_user_info_endpoint` = `user_info_endpoint`,
    `resource_jwks_endpoint` = `jwks_endpoint`,
    `resource_registration_endpoint` = `registration_endpoint`,
    `resource_revocation_endpoint` = `revocation_endpoint`,
    `resource_registration_mode` = `registration_mode`,
    `resource_registration_client_uri` = `registration_client_uri`,
    `resource_registration_access_token` = `registration_access_token`,
    `resource_registration_access_token_context` = `registration_access_token_context`,
    `resource_registered_scopes` = `registered_scopes`,
    `resource_client_generation` = `client_generation`,
    `resource_retired_client_generations` = `retired_client_generations`,
    `resource_provider_metadata` = `provider_metadata`
WHERE `id` IN (SELECT DISTINCT `connector_id` FROM `api_resource` WHERE `connector_id` IS NOT NULL);--> statement-breakpoint
CREATE INDEX `identityProviderConnector_resourceAuthorizationEnabled_idx` ON `identity_provider_connector` (`resource_authorization_enabled`);
