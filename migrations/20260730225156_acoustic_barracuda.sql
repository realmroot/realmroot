PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_api_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`name` text NOT NULL,
	`resource_url` text NOT NULL,
	`connector_id` text,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`connector_id`) REFERENCES `identity_provider_connector`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_api_resource`("id", "identifier", "name", "resource_url", "connector_id", "description", "enabled", "archived_at", "created_at", "updated_at") SELECT "id", "identifier", "name", "resource_url", "authorization_connector_id", "description", "enabled", "archived_at", "created_at", "updated_at" FROM `api_resource`;--> statement-breakpoint
DROP TABLE `api_resource`;--> statement-breakpoint
ALTER TABLE `__new_api_resource` RENAME TO `api_resource`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `api_resource_identifier_unique` ON `api_resource` (`identifier`);--> statement-breakpoint
CREATE UNIQUE INDEX `apiResource_resourceUrl_unique` ON `api_resource` (`resource_url`);--> statement-breakpoint
CREATE INDEX `apiResource_enabled_idx` ON `api_resource` (`enabled`);--> statement-breakpoint
CREATE INDEX `apiResource_connectorId_idx` ON `api_resource` (`connector_id`);
