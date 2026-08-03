ALTER TABLE `identity_provider_connector` ADD `registration_client_uri` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `registered_scopes` text;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `client_generation` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `retired_client_generations` text;--> statement-breakpoint
ALTER TABLE `resource_account_connection` ADD `client_generation` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `resource_connection_intent` ADD `client_generation` integer DEFAULT 1 NOT NULL;