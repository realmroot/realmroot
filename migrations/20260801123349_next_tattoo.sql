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
UPDATE `application`
SET `owner_organization_id` = 'org_platform', `owner_user_id` = NULL
WHERE `owner_organization_id` IS NULL OR `owner_user_id` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `application` ADD `audience_mode` text DEFAULT 'realm' NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `application_owner_organization_required_insert`
BEFORE INSERT ON `application`
FOR EACH ROW
WHEN NEW.`owner_organization_id` IS NULL OR NEW.`owner_user_id` IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'application owner Organization is required');
END;
--> statement-breakpoint
CREATE TRIGGER `application_owner_organization_required_update`
BEFORE UPDATE OF `owner_organization_id`, `owner_user_id` ON `application`
FOR EACH ROW
WHEN NEW.`owner_organization_id` IS NULL OR NEW.`owner_user_id` IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'application owner Organization is required');
END;
--> statement-breakpoint
ALTER TABLE `api_resource` ADD `owner_organization_id` text REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict;
--> statement-breakpoint
UPDATE `api_resource`
SET `owner_organization_id` = 'org_platform'
WHERE `owner_organization_id` IS NULL;
--> statement-breakpoint
ALTER TABLE `api_resource` ADD `access_eligibility_mode` text DEFAULT 'realm' NOT NULL;
--> statement-breakpoint
ALTER TABLE `api_resource` ADD `available_to_agents` integer DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `api_resource_owner_organization_required_insert`
BEFORE INSERT ON `api_resource`
FOR EACH ROW
WHEN NEW.`owner_organization_id` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'resource server owner Organization is required');
END;
--> statement-breakpoint
CREATE TRIGGER `api_resource_owner_organization_required_update`
BEFORE UPDATE OF `owner_organization_id` ON `api_resource`
FOR EACH ROW
WHEN NEW.`owner_organization_id` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'resource server owner Organization is required');
END;
--> statement-breakpoint
CREATE INDEX `apiResource_ownerOrganizationId_idx` ON `api_resource` (`owner_organization_id`);
--> statement-breakpoint
CREATE TABLE `api_resource_eligible_organization` (
	`resource_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apiResourceEligibleOrganization_unique` ON `api_resource_eligible_organization` (`resource_id`,`organization_id`);
--> statement-breakpoint
CREATE INDEX `apiResourceEligibleOrganization_organizationId_idx` ON `api_resource_eligible_organization` (`organization_id`);
--> statement-breakpoint
CREATE TABLE `application_audience_organization` (
	`application_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applicationAudienceOrganization_unique` ON `application_audience_organization` (`application_id`,`organization_id`);
--> statement-breakpoint
CREATE INDEX `applicationAudienceOrganization_organizationId_idx` ON `application_audience_organization` (`organization_id`);
--> statement-breakpoint
CREATE TABLE `application_audience_user` (
	`application_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applicationAudienceUser_unique` ON `application_audience_user` (`application_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `applicationAudienceUser_userId_idx` ON `application_audience_user` (`user_id`);
