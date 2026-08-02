CREATE TABLE `webhook_delivery_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`sequence` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`http_status` integer,
	`error` text,
	`response_body` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`request_id`) REFERENCES `webhook_delivery_request`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhookDeliveryAttempt_requestSequence_uidx` ON `webhook_delivery_attempt` (`request_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `webhookDeliveryAttempt_requestIdempotencyKey_uidx` ON `webhook_delivery_attempt` (`request_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `webhookDeliveryAttempt_requestId_idx` ON `webhook_delivery_attempt` (`request_id`);--> statement-breakpoint
CREATE INDEX `webhookDeliveryAttempt_createdAt_idx` ON `webhook_delivery_attempt` (`created_at`);--> statement-breakpoint
ALTER TABLE `agent_enrollment_intent` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `agentEnrollmentIntent_protocolAgentIdempotencyKey_uidx` ON `agent_enrollment_intent` (`protocol_agent_id`,`idempotency_key`) WHERE "agent_enrollment_intent"."idempotency_key" is not null;