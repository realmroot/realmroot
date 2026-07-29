PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_api_resource` (
  `id` text PRIMARY KEY NOT NULL,
  `identifier` text NOT NULL,
  `name` text NOT NULL,
  `audience` text NOT NULL,
  `resource_url` text NOT NULL,
  `authorization_mode` text DEFAULT 'native' NOT NULL,
  `description` text,
  `enabled` integer DEFAULT true NOT NULL,
  `token_claims_namespace` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_api_resource` (
  `id`,
  `identifier`,
  `name`,
  `audience`,
  `resource_url`,
  `authorization_mode`,
  `description`,
  `enabled`,
  `token_claims_namespace`,
  `created_at`,
  `updated_at`
)
SELECT
  `api_resource`.`id`,
  `api_resource`.`identifier`,
  `api_resource`.`name`,
  `api_resource`.`audience`,
  COALESCE(`external_resource_authorization`.`resource_url`, `api_resource`.`audience`),
  `api_resource`.`authorization_mode`,
  `api_resource`.`description`,
  `api_resource`.`enabled`,
  `api_resource`.`token_claims_namespace`,
  `api_resource`.`created_at`,
  `api_resource`.`updated_at`
FROM `api_resource`
LEFT JOIN `external_resource_authorization`
  ON `external_resource_authorization`.`resource_id` = `api_resource`.`id`;
--> statement-breakpoint
DROP TABLE `api_resource`;
--> statement-breakpoint
ALTER TABLE `__new_api_resource` RENAME TO `api_resource`;
--> statement-breakpoint
CREATE UNIQUE INDEX `api_resource_identifier_unique` ON `api_resource` (`identifier`);
--> statement-breakpoint
CREATE INDEX `apiResource_enabled_idx` ON `api_resource` (`enabled`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
