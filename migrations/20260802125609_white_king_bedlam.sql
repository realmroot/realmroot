ALTER TABLE `api_resource` ADD `authorization_details` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_access_grant` ADD `authorization_details` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_access_request` ADD `authorization_details` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `external_token_lease` ADD `authorization_details` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `resource_account_connection` ADD `authorization_details` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `resource_connection_intent` ADD `authorization_details` text DEFAULT '[]' NOT NULL;