CREATE TABLE `agent_role_assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`agent_identity_id` text NOT NULL,
	`assigned_by_user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agentRoleAssignment_roleId_agentIdentityId_unique` ON `agent_role_assignment` (`role_id`,`agent_identity_id`);--> statement-breakpoint
CREATE INDEX `agentRoleAssignment_roleId_idx` ON `agent_role_assignment` (`role_id`);--> statement-breakpoint
CREATE INDEX `agentRoleAssignment_agentIdentityId_idx` ON `agent_role_assignment` (`agent_identity_id`);--> statement-breakpoint
CREATE TABLE `role_scope` (
	`role_id` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roleScope_roleId_scope_unique` ON `role_scope` (`role_id`,`scope`);--> statement-breakpoint
DROP TABLE `api_permission`;--> statement-breakpoint
DROP TABLE `api_scope`;--> statement-breakpoint
DROP TABLE `role_permission`;--> statement-breakpoint
ALTER TABLE `api_resource` DROP COLUMN `token_claims_namespace`;--> statement-breakpoint
ALTER TABLE `application_role_assignment` DROP COLUMN `token_claims`;--> statement-breakpoint
ALTER TABLE `member_role_assignment` DROP COLUMN `token_claims`;--> statement-breakpoint
ALTER TABLE `role` DROP COLUMN `token_claim_name`;--> statement-breakpoint
ALTER TABLE `role` DROP COLUMN `token_claim_value`;--> statement-breakpoint
ALTER TABLE `user_role_assignment` DROP COLUMN `token_claims`;--> statement-breakpoint
ALTER TABLE `external_resource_authorization` DROP COLUMN `scopes_supported`;