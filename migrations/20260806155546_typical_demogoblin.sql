CREATE TABLE `application_scope_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`resource_server_id` text NOT NULL,
	`scopes` text NOT NULL,
	`granted_by_user_id` text NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_server_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `applicationScopeGrant_applicationId_idx` ON `application_scope_grant` (`application_id`);--> statement-breakpoint
CREATE INDEX `applicationScopeGrant_resourceServerId_idx` ON `application_scope_grant` (`resource_server_id`);--> statement-breakpoint
CREATE TABLE `user_scope_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text,
	`resource_server_id` text NOT NULL,
	`scopes` text NOT NULL,
	`granted_by_user_id` text NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_server_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `userScopeGrant_userId_idx` ON `user_scope_grant` (`user_id`);--> statement-breakpoint
CREATE INDEX `userScopeGrant_resourceServerId_idx` ON `user_scope_grant` (`resource_server_id`);--> statement-breakpoint
CREATE INDEX `userScopeGrant_organizationId_idx` ON `user_scope_grant` (`organization_id`);--> statement-breakpoint
DROP TABLE `api_resource_eligible_organization`;--> statement-breakpoint
DROP TABLE `application_audience_organization`;--> statement-breakpoint
DROP TABLE `application_audience_user`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_api_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`name` text NOT NULL,
	`resource_url` text NOT NULL,
	`connector_id` text,
	`authorization_details` text DEFAULT '[]' NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`owner_organization_id` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`scope_registry` text,
	`available_to_agents` integer DEFAULT true NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`connector_id`) REFERENCES `identity_provider_connector`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_api_resource`("id", "identifier", "name", "resource_url", "connector_id", "authorization_details", "description", "enabled", "owner_organization_id", "visibility", "scope_registry", "available_to_agents", "archived_at", "created_at", "updated_at") SELECT "id", "identifier", "name", "resource_url", "connector_id", "authorization_details", "description", "enabled", "owner_organization_id", CASE WHEN "access_eligibility_mode" = 'owner_organization' THEN 'private' ELSE 'public' END, NULL, "available_to_agents", "archived_at", "created_at", "updated_at" FROM `api_resource`;--> statement-breakpoint
DROP TABLE `api_resource`;--> statement-breakpoint
ALTER TABLE `__new_api_resource` RENAME TO `api_resource`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `api_resource_identifier_unique` ON `api_resource` (`identifier`);--> statement-breakpoint
CREATE UNIQUE INDEX `apiResource_resourceUrl_unique` ON `api_resource` (`resource_url`);--> statement-breakpoint
CREATE INDEX `apiResource_enabled_idx` ON `api_resource` (`enabled`);--> statement-breakpoint
CREATE INDEX `apiResource_connectorId_idx` ON `api_resource` (`connector_id`);--> statement-breakpoint
CREATE INDEX `apiResource_ownerOrganizationId_idx` ON `api_resource` (`owner_organization_id`);--> statement-breakpoint
DROP INDEX `applicationConsent_activeApplicationUser_unique`;--> statement-breakpoint
ALTER TABLE `application_consent` ADD `resource_server_id` text REFERENCES api_resource(id);--> statement-breakpoint
UPDATE `application_consent` SET `revoked_at` = cast(unixepoch('subsecond') * 1000 as integer) WHERE `revoked_at` IS NULL;--> statement-breakpoint
DELETE FROM `oauth_consent`;--> statement-breakpoint
CREATE INDEX `applicationConsent_resourceServerId_idx` ON `application_consent` (`resource_server_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `applicationConsent_activePrincipalResource_unique` ON `application_consent` (`application_id`,`user_id`,`resource_server_id`) WHERE "application_consent"."revoked_at" is null and "application_consent"."resource_server_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `applicationConsent_activeOidcPrincipal_unique` ON `application_consent` (`application_id`,`user_id`) WHERE "application_consent"."revoked_at" is null and "application_consent"."resource_server_id" is null;--> statement-breakpoint
ALTER TABLE `application` ADD `oidc_scopes` text DEFAULT '["openid","profile","email"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `application` ADD `resource_scopes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `application` SET `oidc_scopes` = CASE WHEN EXISTS (SELECT 1 FROM `oauth_client` WHERE `oauth_client`.`client_id` = `application`.`oauth_client_id` AND instr(`oauth_client`.`scopes`, '"offline_access"') > 0) THEN '["openid","profile","email","offline_access"]' ELSE '["openid","profile","email"]' END;--> statement-breakpoint
UPDATE `organization_role` SET `permission` = json_set(`permission`, '$.scope', COALESCE((SELECT json_group_array(value) FROM json_each(json_extract(`organization_role`.`permission`, '$.scope')) WHERE value LIKE 'res_realmroot/%'), json('[]')));--> statement-breakpoint
ALTER TABLE `application` DROP COLUMN `audience_mode`;
