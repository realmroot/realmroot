CREATE TABLE `agent_application_creation` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`agent_identity_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agentApplicationCreation_applicationActorKey_unique` ON `agent_application_creation` (`application_id`,`actor_user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `agentApplicationCreation_agentIdentityId_unique` ON `agent_application_creation` (`agent_identity_id`);