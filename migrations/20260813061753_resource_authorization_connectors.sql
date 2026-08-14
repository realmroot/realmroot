ALTER TABLE `api_resource` RENAME COLUMN "access_mode" TO "authorization_model";--> statement-breakpoint
ALTER TABLE `identity_provider_connector` RENAME COLUMN "login_enabled" TO "authentication_enabled";--> statement-breakpoint
CREATE TABLE `__provider_credential_backfill` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_resource_authorization_id` text NOT NULL,
	`external_subject` text NOT NULL,
	`display_name` text NOT NULL,
	`credential_custody` text NOT NULL,
	`encrypted_tokens` text,
	`broker_reference` text,
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
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__provider_credential_backfill` (
	`id`,
	`provider_resource_authorization_id`,
	`external_subject`,
	`display_name`,
	`credential_custody`,
	`encrypted_tokens`,
	`broker_reference`,
	`granted_scopes`,
	`authorization_details`,
	`authority_constraints`,
	`client_generation`,
	`credential_version`,
	`refresh_claim_id`,
	`refresh_claim_expires_at`,
	`status`,
	`credential_expires_at`,
	`revoked_at`,
	`created_at`,
	`updated_at`
)
SELECT
	a.`id`,
	a.`id`,
	c.`external_subject`,
	c.`display_name`,
	a.`credential_custody`,
	a.`encrypted_tokens`,
	a.`broker_reference`,
	a.`granted_scopes`,
	a.`authorization_details`,
	a.`authority_constraints`,
	a.`client_generation`,
	a.`credential_version`,
	a.`refresh_claim_id`,
	a.`refresh_claim_expires_at`,
	a.`status`,
	a.`credential_expires_at`,
	a.`revoked_at`,
	a.`created_at`,
	a.`updated_at`
FROM `provider_resource_authorization` a
JOIN `provider_connection` c ON c.`id` = a.`provider_connection_id`;--> statement-breakpoint
DROP INDEX `apiResource_providerConnectionAuthority_unique`;--> statement-breakpoint
ALTER TABLE `api_resource` ADD `provider_connection_mode` text;--> statement-breakpoint
UPDATE `api_resource`
SET `provider_connection_mode` = CASE
  WHEN `authorization_model` = 'brokered' THEN 'brokered'
  WHEN `connector_id` IS NOT NULL THEN 'managed'
  ELSE NULL
END;--> statement-breakpoint
UPDATE `api_resource`
SET `authorization_model` = CASE
  WHEN `authorization_model` = 'external_oauth' THEN 'federated'
  ELSE 'realmroot'
END;--> statement-breakpoint
UPDATE `api_resource`
SET `authorization_model` = 'realmroot',
    `provider_connection_mode` = 'managed',
    `scope_registry` = json_remove(`scope_registry`, '$.accountConnection')
WHERE `connector_id` IN (
  SELECT `id` FROM `identity_provider_connector` WHERE `provider_id` = 'linear'
);--> statement-breakpoint
CREATE UNIQUE INDEX `apiResource_providerConnectionAuthority_unique` ON `api_resource` (`connector_id`) WHERE "api_resource"."deleted_at" is null and "api_resource"."provider_connection_mode" = 'brokered';--> statement-breakpoint
DROP INDEX `identityProviderConnector_loginEnabled_idx`;--> statement-breakpoint
CREATE INDEX `identityProviderConnector_authenticationEnabled_idx` ON `identity_provider_connector` (`authentication_enabled`);--> statement-breakpoint
DROP TRIGGER `account_provider_connection_delete`;--> statement-breakpoint
CREATE TABLE `__agent_access_request_connection_backfill` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL
);--> statement-breakpoint
INSERT INTO `__agent_access_request_connection_backfill`
SELECT `id`, `connection_id` FROM `agent_access_request` WHERE `connection_id` IS NOT NULL;--> statement-breakpoint
UPDATE `agent_access_request` SET `connection_id` = NULL WHERE `connection_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__resource_scope_entitlement_connection_backfill` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL
);--> statement-breakpoint
INSERT INTO `__resource_scope_entitlement_connection_backfill`
SELECT `id`, `connection_id` FROM `resource_scope_entitlement` WHERE `connection_id` IS NOT NULL;--> statement-breakpoint
UPDATE `resource_scope_entitlement` SET `connection_id` = NULL WHERE `connection_id` IS NOT NULL;--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_provider_resource_authorization` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_connection_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`revoked_at` integer,
	`provider_event_occurred_at` integer,
	`provider_event_revision` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`provider_connection_id`) REFERENCES `provider_connection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_provider_resource_authorization`("id", "provider_connection_id", "resource_id", "status", "revoked_at", "provider_event_occurred_at", "provider_event_revision", "created_at", "updated_at") SELECT "id", "provider_connection_id", "resource_id", "status", "revoked_at", "provider_event_occurred_at", "provider_event_revision", "created_at", "updated_at" FROM `provider_resource_authorization`;--> statement-breakpoint
DROP TABLE `provider_resource_authorization`;--> statement-breakpoint
ALTER TABLE `__new_provider_resource_authorization` RENAME TO `provider_resource_authorization`;--> statement-breakpoint
UPDATE `agent_access_request`
SET `connection_id` = (
	SELECT b.`connection_id` FROM `__agent_access_request_connection_backfill` b
	WHERE b.`id` = `agent_access_request`.`id`
)
WHERE `id` IN (SELECT `id` FROM `__agent_access_request_connection_backfill`);--> statement-breakpoint
DROP TABLE `__agent_access_request_connection_backfill`;--> statement-breakpoint
UPDATE `resource_scope_entitlement`
SET `connection_id` = (
	SELECT b.`connection_id` FROM `__resource_scope_entitlement_connection_backfill` b
	WHERE b.`id` = `resource_scope_entitlement`.`id`
)
WHERE `id` IN (SELECT `id` FROM `__resource_scope_entitlement_connection_backfill`);--> statement-breakpoint
DROP TABLE `__resource_scope_entitlement_connection_backfill`;--> statement-breakpoint
CREATE UNIQUE INDEX `providerResourceAuthorization_connection_resource_unique` ON `provider_resource_authorization` (`provider_connection_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `providerResourceAuthorization_providerConnectionId_idx` ON `provider_resource_authorization` (`provider_connection_id`);--> statement-breakpoint
CREATE INDEX `providerResourceAuthorization_resourceId_idx` ON `provider_resource_authorization` (`resource_id`);--> statement-breakpoint
CREATE INDEX `providerResourceAuthorization_status_idx` ON `provider_resource_authorization` (`status`);--> statement-breakpoint
CREATE TABLE `provider_credential` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_resource_authorization_id` text NOT NULL,
	`external_subject` text NOT NULL,
	`display_name` text NOT NULL,
	`credential_custody` text NOT NULL,
	`encrypted_tokens` text,
	`broker_reference` text,
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
	FOREIGN KEY (`provider_resource_authorization_id`) REFERENCES `provider_resource_authorization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "providerCredential_custody_check" CHECK((
        ("provider_credential"."credential_custody" = 'realmroot' AND "provider_credential"."encrypted_tokens" IS NOT NULL AND "provider_credential"."broker_reference" IS NULL)
        OR
        ("provider_credential"."credential_custody" = 'resource_server' AND "provider_credential"."encrypted_tokens" IS NULL AND "provider_credential"."broker_reference" IS NOT NULL)
      ))
);--> statement-breakpoint
INSERT INTO `provider_credential` SELECT * FROM `__provider_credential_backfill`;--> statement-breakpoint
DROP TABLE `__provider_credential_backfill`;--> statement-breakpoint
CREATE UNIQUE INDEX `providerCredential_authorization_subject_unique` ON `provider_credential` (`provider_resource_authorization_id`,`external_subject`);--> statement-breakpoint
CREATE INDEX `providerCredential_authorizationId_idx` ON `provider_credential` (`provider_resource_authorization_id`);--> statement-breakpoint
CREATE INDEX `providerCredential_brokerReference_idx` ON `provider_credential` (`broker_reference`);--> statement-breakpoint
CREATE INDEX `providerCredential_status_idx` ON `provider_credential` (`status`);--> statement-breakpoint
UPDATE `provider_credential`
SET `status` = 'revoked',
    `revoked_at` = cast(unixepoch('subsecond') * 1000 as integer),
    `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `provider_resource_authorization_id` IN (
  SELECT a.`id`
  FROM `provider_resource_authorization` a
  JOIN `api_resource` r ON r.`id` = a.`resource_id`
  JOIN `identity_provider_connector` c ON c.`id` = r.`connector_id`
  WHERE c.`provider_id` = 'linear'
);--> statement-breakpoint
UPDATE `provider_resource_authorization`
SET `status` = 'revoked',
    `revoked_at` = cast(unixepoch('subsecond') * 1000 as integer),
    `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `resource_id` IN (
  SELECT r.`id`
  FROM `api_resource` r
  JOIN `identity_provider_connector` c ON c.`id` = r.`connector_id`
  WHERE c.`provider_id` = 'linear'
);--> statement-breakpoint
CREATE TRIGGER `account_provider_connection_delete`
AFTER DELETE ON `account`
WHEN OLD.`provider_id` <> 'credential'
BEGIN
	UPDATE `provider_connection`
	SET `authentication_account_id` = NULL,
		`updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
	WHERE `authentication_account_id` = OLD.`id`;
	DELETE FROM `provider_connection`
	WHERE `authentication_account_id` IS NULL
		AND NOT EXISTS (
			SELECT 1
			FROM `provider_resource_authorization` a
			WHERE a.`provider_connection_id` = `provider_connection`.`id`
		);
END;--> statement-breakpoint
DROP INDEX `providerConnection_active_user_subject_unique`;--> statement-breakpoint
