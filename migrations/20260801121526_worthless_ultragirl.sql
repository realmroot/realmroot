DROP TABLE `agent_role_assignment`;--> statement-breakpoint
DROP TABLE `application_role_assignment`;--> statement-breakpoint
DROP TABLE `member_role_assignment`;--> statement-breakpoint
DROP TABLE `role_scope`;--> statement-breakpoint
DROP TABLE `user_role_assignment`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_role` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`system` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_role`("id", "key", "name", "description", "system", "created_at", "updated_at") SELECT "id", "key", "name", "description", "system", "created_at", "updated_at" FROM `role`;--> statement-breakpoint
DROP TABLE `role`;--> statement-breakpoint
ALTER TABLE `__new_role` RENAME TO `role`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `role_key_idx` ON `role` (`key`);