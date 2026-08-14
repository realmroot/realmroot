UPDATE `api_resource`
SET `authorization_model` = CASE WHEN `connector_id` IS NULL THEN 'native' ELSE 'external' END;--> statement-breakpoint
DROP INDEX `apiResource_providerConnectionAuthority_unique`;--> statement-breakpoint
ALTER TABLE `api_resource` DROP COLUMN `provider_connection_mode`;--> statement-breakpoint
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
