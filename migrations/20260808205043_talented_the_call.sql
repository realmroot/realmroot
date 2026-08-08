ALTER TABLE `api_resource` ADD `access_mode` text DEFAULT 'realmroot' NOT NULL;--> statement-breakpoint
UPDATE `api_resource`
SET `access_mode` = 'brokered'
WHERE `connector_id` IS NOT NULL
  AND json_extract(`scope_registry`, '$.accountConnection.mode') = 'brokered';--> statement-breakpoint
UPDATE `api_resource`
SET `access_mode` = 'external_oauth'
WHERE `connector_id` IS NOT NULL
  AND `access_mode` = 'realmroot';--> statement-breakpoint
DROP INDEX `apiResource_providerConnectionAuthority_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `apiResource_providerConnectionAuthority_unique` ON `api_resource` (`connector_id`) WHERE "api_resource"."deleted_at" is null and "api_resource"."access_mode" = 'brokered';--> statement-breakpoint
CREATE UNIQUE INDEX `account_providerId_accountId_unique` ON `account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `providerConnection_active_user_subject_unique` ON `provider_connection` (`connector_id`,`external_subject`) WHERE "provider_connection"."owner_user_id" IS NOT NULL AND "provider_connection"."status" = 'active';
