ALTER TABLE `application` RENAME COLUMN `trusted` TO `legacy_trusted`;
--> statement-breakpoint
ALTER TABLE `application` ADD COLUMN `consent_required` integer DEFAULT true NOT NULL;
--> statement-breakpoint
UPDATE `application` SET `consent_required` = NOT `legacy_trusted`;
--> statement-breakpoint
UPDATE `application`
SET `consent_required` = true
WHERE `owner_organization_id` NOT IN (SELECT `id` FROM `organization` WHERE `slug` = 'realmroot');
--> statement-breakpoint
ALTER TABLE `application` DROP COLUMN `legacy_trusted`;
--> statement-breakpoint
ALTER TABLE `application` DROP COLUMN `first_party`;
--> statement-breakpoint
UPDATE `oauth_client` SET `skip_consent` = 1;
