ALTER TABLE `provider_resource_authorization` ADD `credential_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_resource_authorization` ADD `refresh_claim_id` text;--> statement-breakpoint
ALTER TABLE `provider_resource_authorization` ADD `refresh_claim_expires_at` integer;