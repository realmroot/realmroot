CREATE TABLE `api_resource_eligible_organization` (
	`resource_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apiResourceEligibleOrganization_unique` ON `api_resource_eligible_organization` (`resource_id`,`organization_id`);--> statement-breakpoint
CREATE INDEX `apiResourceEligibleOrganization_organizationId_idx` ON `api_resource_eligible_organization` (`organization_id`);--> statement-breakpoint
CREATE TABLE `application_audience_organization` (
	`application_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applicationAudienceOrganization_unique` ON `application_audience_organization` (`application_id`,`organization_id`);--> statement-breakpoint
CREATE INDEX `applicationAudienceOrganization_organizationId_idx` ON `application_audience_organization` (`organization_id`);--> statement-breakpoint
CREATE TABLE `application_audience_user` (
	`application_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applicationAudienceUser_unique` ON `application_audience_user` (`application_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `applicationAudienceUser_userId_idx` ON `application_audience_user` (`user_id`);--> statement-breakpoint
INSERT INTO `organization` (`id`, `slug`, `name`, `metadata`)
VALUES ('org_platform', 'realmroot-platform', 'Realmroot Platform', '{"realmroot":{"platform":true}}')
ON CONFLICT(`id`) DO NOTHING;
--> statement-breakpoint
INSERT OR IGNORE INTO `member` (`id`, `organization_id`, `user_id`, `role`)
SELECT 'member_platform_' || substr(`id`, 1, 16), 'org_platform', `id`, 'owner'
FROM `user`
ORDER BY (`role` = 'admin') DESC, `created_at` ASC
LIMIT 1;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_application` (
	`id` text PRIMARY KEY NOT NULL,
	`oauth_client_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`homepage_url` text,
	`logo_asset_id` text,
	`owner_organization_id` text NOT NULL,
	`audience_mode` text DEFAULT 'realm' NOT NULL,
	`first_party` integer DEFAULT false NOT NULL,
	`trusted` integer DEFAULT false NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`disabled_reason` text,
	`access_token_ttl_seconds` integer,
	`refresh_token_ttl_seconds` integer,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`oauth_client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`logo_asset_id`) REFERENCES `uploaded_asset`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_application`("id", "oauth_client_id", "slug", "name", "description", "homepage_url", "logo_asset_id", "owner_organization_id", "audience_mode", "first_party", "trusted", "disabled", "disabled_reason", "access_token_ttl_seconds", "refresh_token_ttl_seconds", "metadata", "created_at", "updated_at") SELECT "id", "oauth_client_id", "slug", "name", "description", "homepage_url", "logo_asset_id", COALESCE("owner_organization_id", 'org_platform'), 'realm', "first_party", "trusted", "disabled", "disabled_reason", "access_token_ttl_seconds", "refresh_token_ttl_seconds", "metadata", "created_at", "updated_at" FROM `application`;--> statement-breakpoint
DROP TABLE `application`;--> statement-breakpoint
ALTER TABLE `__new_application` RENAME TO `application`;--> statement-breakpoint
CREATE UNIQUE INDEX `application_slug_unique` ON `application` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_oauthClientId_unique` ON `application` (`oauth_client_id`);--> statement-breakpoint
CREATE INDEX `application_ownerOrganizationId_idx` ON `application` (`owner_organization_id`);--> statement-breakpoint
CREATE INDEX `application_disabled_idx` ON `application` (`disabled`);--> statement-breakpoint
CREATE TABLE `__new_api_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`name` text NOT NULL,
	`resource_url` text NOT NULL,
	`connector_id` text,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`owner_organization_id` text NOT NULL,
	`access_eligibility_mode` text DEFAULT 'realm' NOT NULL,
	`available_to_agents` integer DEFAULT true NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`connector_id`) REFERENCES `identity_provider_connector`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_api_resource` (`id`, `identifier`, `name`, `resource_url`, `connector_id`, `description`, `enabled`, `owner_organization_id`, `access_eligibility_mode`, `available_to_agents`, `archived_at`, `created_at`, `updated_at`)
SELECT `id`, `identifier`, `name`, `resource_url`, `connector_id`, `description`, `enabled`, 'org_platform', 'realm', true, `archived_at`, `created_at`, `updated_at`
FROM `api_resource`;
--> statement-breakpoint
DROP TABLE `api_resource`;--> statement-breakpoint
ALTER TABLE `__new_api_resource` RENAME TO `api_resource`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `api_resource_identifier_unique` ON `api_resource` (`identifier`);--> statement-breakpoint
CREATE UNIQUE INDEX `apiResource_resourceUrl_unique` ON `api_resource` (`resource_url`);--> statement-breakpoint
CREATE INDEX `apiResource_enabled_idx` ON `api_resource` (`enabled`);--> statement-breakpoint
CREATE INDEX `apiResource_connectorId_idx` ON `api_resource` (`connector_id`);--> statement-breakpoint
CREATE INDEX `apiResource_ownerOrganizationId_idx` ON `api_resource` (`owner_organization_id`);
