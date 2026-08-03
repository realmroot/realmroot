CREATE TABLE `agent_connection_request` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`agent_identity_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`scopes` text NOT NULL,
	`authorization_details` text DEFAULT '[]' NOT NULL,
	`reason` text,
	`approval_token_hash` text NOT NULL,
	`encrypted_approval_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`binding_id`) REFERENCES `agent_identity_binding`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_connection_request_approval_token_hash_unique` ON `agent_connection_request` (`approval_token_hash`);--> statement-breakpoint
CREATE INDEX `agentConnectionRequest_resourceId_idx` ON `agent_connection_request` (`resource_id`);--> statement-breakpoint
CREATE INDEX `agentConnectionRequest_agentIdentityId_idx` ON `agent_connection_request` (`agent_identity_id`);--> statement-breakpoint
CREATE INDEX `agentConnectionRequest_expiresAt_idx` ON `agent_connection_request` (`expires_at`);