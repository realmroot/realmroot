CREATE TABLE `provider_connection_event_receipt` (
	`resource` text NOT NULL,
	`id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`claim_token` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`revision` integer NOT NULL,
	`received_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`applied_at` integer,
	PRIMARY KEY(`resource`, `id`)
);
--> statement-breakpoint
CREATE INDEX `providerConnectionEventReceipt_receivedAt_idx` ON `provider_connection_event_receipt` (`received_at`);--> statement-breakpoint
ALTER TABLE `provider_resource_authorization` ADD `provider_event_occurred_at` integer;--> statement-breakpoint
ALTER TABLE `provider_resource_authorization` ADD `provider_event_revision` integer;