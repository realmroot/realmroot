PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_access_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`connection_id` text,
	`agent_identity_id` text NOT NULL,
	`scopes` text NOT NULL,
	`authorization_details` text DEFAULT '[]' NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`granted_by_user_id` text,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`connection_id`) REFERENCES `resource_account_connection`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`granted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_agent_access_grant`("id", "resource_id", "connection_id", "agent_identity_id", "scopes", "authorization_details", "mode", "status", "granted_by_user_id", "expires_at", "revoked_at", "created_at", "updated_at") SELECT "id", "resource_id", "connection_id", "agent_identity_id", "scopes", "authorization_details", "mode", "status", "granted_by_user_id", "expires_at", "revoked_at", "created_at", "updated_at" FROM `agent_access_grant`;--> statement-breakpoint
DROP TABLE `agent_access_grant`;--> statement-breakpoint
ALTER TABLE `__new_agent_access_grant` RENAME TO `agent_access_grant`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agentAccessGrant_resourceId_idx` ON `agent_access_grant` (`resource_id`);--> statement-breakpoint
CREATE INDEX `agentAccessGrant_connectionId_idx` ON `agent_access_grant` (`connection_id`);--> statement-breakpoint
CREATE INDEX `agentAccessGrant_agentIdentityId_idx` ON `agent_access_grant` (`agent_identity_id`);--> statement-breakpoint
CREATE INDEX `agentAccessGrant_status_idx` ON `agent_access_grant` (`status`);