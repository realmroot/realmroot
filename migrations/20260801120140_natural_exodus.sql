CREATE TABLE `role_assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`organization_id` text,
	`assigned_by_user_id` text,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "roleAssignment_subjectType_check" CHECK("role_assignment"."subject_type" in ('user', 'agent', 'workload'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roleAssignment_realm_unique` ON `role_assignment` (`role_id`,`subject_type`,`subject_id`) WHERE "role_assignment"."organization_id" is null and "role_assignment"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `roleAssignment_organization_unique` ON `role_assignment` (`role_id`,`subject_type`,`subject_id`,`organization_id`) WHERE "role_assignment"."organization_id" is not null and "role_assignment"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX `roleAssignment_roleId_idx` ON `role_assignment` (`role_id`);--> statement-breakpoint
CREATE INDEX `roleAssignment_subject_idx` ON `role_assignment` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `roleAssignment_organizationId_idx` ON `role_assignment` (`organization_id`);--> statement-breakpoint
CREATE TABLE `role_permission` (
	`role_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rolePermission_roleId_resourceId_scope_unique` ON `role_permission` (`role_id`,`resource_id`,`scope`);--> statement-breakpoint
CREATE INDEX `rolePermission_roleId_idx` ON `role_permission` (`role_id`);--> statement-breakpoint
CREATE INDEX `rolePermission_resourceId_idx` ON `role_permission` (`resource_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permission` (`role_id`, `resource_id`, `scope`, `created_at`)
SELECT `role_scope`.`role_id`, `role`.`resource_id`, `role_scope`.`scope`, `role_scope`.`created_at`
FROM `role_scope`
JOIN `role` ON `role`.`id` = `role_scope`.`role_id`
WHERE `role`.`resource_id` IS NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `role_assignment`
  (`id`, `role_id`, `subject_type`, `subject_id`, `organization_id`, `assigned_by_user_id`, `expires_at`, `created_at`, `updated_at`)
SELECT `id`, `role_id`, 'user', `user_id`, NULL, `assigned_by_user_id`, `expires_at`, `created_at`, `created_at`
FROM `user_role_assignment`;
--> statement-breakpoint
INSERT OR IGNORE INTO `role_assignment`
  (`id`, `role_id`, `subject_type`, `subject_id`, `organization_id`, `assigned_by_user_id`, `expires_at`, `created_at`, `updated_at`)
SELECT `id`, `role_id`, 'workload', `application_id`, NULL, `assigned_by_user_id`, `expires_at`, `created_at`, `created_at`
FROM `application_role_assignment`;
--> statement-breakpoint
INSERT OR IGNORE INTO `role_assignment`
  (`id`, `role_id`, `subject_type`, `subject_id`, `organization_id`, `assigned_by_user_id`, `expires_at`, `created_at`, `updated_at`)
SELECT `member_role_assignment`.`id`, `member_role_assignment`.`role_id`, 'user', `member`.`user_id`, `member`.`organization_id`,
  `member_role_assignment`.`assigned_by_user_id`, `member_role_assignment`.`expires_at`,
  `member_role_assignment`.`created_at`, `member_role_assignment`.`created_at`
FROM `member_role_assignment`
JOIN `member` ON `member`.`id` = `member_role_assignment`.`member_id`;
--> statement-breakpoint
INSERT OR IGNORE INTO `role_assignment`
  (`id`, `role_id`, `subject_type`, `subject_id`, `organization_id`, `assigned_by_user_id`, `expires_at`, `created_at`, `updated_at`)
SELECT `agent_role_assignment`.`id`, `agent_role_assignment`.`role_id`, 'agent', `agent_role_assignment`.`agent_identity_id`,
  `role`.`organization_id`, `agent_role_assignment`.`assigned_by_user_id`, `agent_role_assignment`.`expires_at`,
  `agent_role_assignment`.`created_at`, `agent_role_assignment`.`created_at`
FROM `agent_role_assignment`
JOIN `role` ON `role`.`id` = `agent_role_assignment`.`role_id`;
