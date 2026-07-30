ALTER TABLE `api_resource` ADD `authorization_connector_id` text REFERENCES identity_provider_connector(id);--> statement-breakpoint
CREATE INDEX `apiResource_authorizationConnectorId_idx` ON `api_resource` (`authorization_connector_id`);--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `login_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `client_secret_context` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `registration_endpoint` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `revocation_endpoint` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `registration_mode` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `registration_access_token` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `registration_access_token_context` text;--> statement-breakpoint
INSERT INTO `identity_provider_connector` (
  `id`,
  `slug`,
  `provider_type`,
  `provider_id`,
  `display_name`,
  `enabled`,
  `login_enabled`,
  `client_id`,
  `client_secret`,
  `client_secret_context`,
  `issuer`,
  `authorization_endpoint`,
  `token_endpoint`,
  `user_info_endpoint`,
  `jwks_endpoint`,
  `registration_endpoint`,
  `revocation_endpoint`,
  `registration_mode`,
  `registration_access_token`,
  `registration_access_token_context`,
  `scopes`,
  `provider_metadata`,
  `created_at`,
  `updated_at`
)
SELECT
  `external_resource_authorization`.`resource_id`,
  'external-resource-' || `external_resource_authorization`.`resource_id`,
  'generic_oauth',
  'external-resource-' || `external_resource_authorization`.`resource_id`,
  `api_resource`.`name`,
  CASE WHEN `external_resource_authorization`.`status` = 'active' THEN true ELSE false END,
  false,
  `external_resource_authorization`.`client_id`,
  `external_resource_authorization`.`encrypted_client_secret`,
  'external-resource:' || `external_resource_authorization`.`resource_id` || ':client-secret',
  `external_resource_authorization`.`issuer`,
  `external_resource_authorization`.`authorization_endpoint`,
  `external_resource_authorization`.`token_endpoint`,
  `external_resource_authorization`.`userinfo_endpoint`,
  `external_resource_authorization`.`jwks_uri`,
  `external_resource_authorization`.`registration_endpoint`,
  `external_resource_authorization`.`revocation_endpoint`,
  `external_resource_authorization`.`registration_mode`,
  `external_resource_authorization`.`encrypted_registration_access_token`,
  CASE
    WHEN `external_resource_authorization`.`encrypted_registration_access_token` IS NULL THEN NULL
    ELSE 'external-resource:' || `external_resource_authorization`.`resource_id` || ':registration-token'
  END,
  '["openid","profile","email","offline_access"]',
  `external_resource_authorization`.`metadata`,
  `external_resource_authorization`.`created_at`,
  `external_resource_authorization`.`updated_at`
FROM `external_resource_authorization`
INNER JOIN `api_resource`
  ON `api_resource`.`id` = `external_resource_authorization`.`resource_id`;--> statement-breakpoint
UPDATE `api_resource`
SET `authorization_connector_id` = `id`
WHERE `id` IN (SELECT `resource_id` FROM `external_resource_authorization`);--> statement-breakpoint
CREATE INDEX `identityProviderConnector_loginEnabled_idx` ON `identity_provider_connector` (`login_enabled`);
