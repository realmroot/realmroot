CREATE TABLE `organization_role` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`role` text NOT NULL,
	`permission` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizationRole_organizationId_role_unique` ON `organization_role` (`organization_id`,`role`);--> statement-breakpoint
CREATE INDEX `organizationRole_organizationId_idx` ON `organization_role` (`organization_id`);--> statement-breakpoint
DROP TABLE `role_assignment`;--> statement-breakpoint
DROP TABLE `role_permission`;--> statement-breakpoint
DROP TABLE `role`;
