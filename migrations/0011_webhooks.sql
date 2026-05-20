CREATE TABLE `webhook_endpoint` (
  `id` text PRIMARY KEY NOT NULL,
  `url` text NOT NULL,
  `events` text NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `signing_secret` text NOT NULL,
  `secret_prefix` text NOT NULL,
  `created_by_user_id` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `webhookEndpoint_enabled_idx` ON `webhook_endpoint` (`enabled`);
--> statement-breakpoint
CREATE INDEX `webhookEndpoint_createdByUserId_idx` ON `webhook_endpoint` (`created_by_user_id`);
--> statement-breakpoint
CREATE TABLE `webhook_delivery_request` (
  `id` text PRIMARY KEY NOT NULL,
  `endpoint_id` text NOT NULL,
  `event` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `http_status` integer,
  `error` text,
  `request_body` text,
  `response_body` text,
  `next_attempt_at` integer,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoint`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhookDeliveryRequest_endpointId_idx` ON `webhook_delivery_request` (`endpoint_id`);
--> statement-breakpoint
CREATE INDEX `webhookDeliveryRequest_status_idx` ON `webhook_delivery_request` (`status`);
--> statement-breakpoint
CREATE INDEX `webhookDeliveryRequest_createdAt_idx` ON `webhook_delivery_request` (`created_at`);
