CREATE TABLE `agent_host` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text,
  `user_id` text,
  `default_capabilities` text,
  `public_key` text,
  `kid` text,
  `jwks_url` text,
  `enrollment_token_hash` text,
  `enrollment_token_expires_at` integer,
  `status` text DEFAULT 'active' NOT NULL,
  `activated_at` integer,
  `expires_at` integer,
  `last_used_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agentHost_userId_idx` ON `agent_host` (`user_id`);
--> statement-breakpoint
CREATE INDEX `agentHost_kid_idx` ON `agent_host` (`kid`);
--> statement-breakpoint
CREATE INDEX `agentHost_enrollmentTokenHash_idx` ON `agent_host` (`enrollment_token_hash`);
--> statement-breakpoint
CREATE INDEX `agentHost_status_idx` ON `agent_host` (`status`);
--> statement-breakpoint
CREATE TABLE `agent` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `user_id` text,
  `host_id` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `mode` text DEFAULT 'delegated' NOT NULL,
  `public_key` text NOT NULL,
  `kid` text,
  `jwks_url` text,
  `last_used_at` integer,
  `activated_at` integer,
  `expires_at` integer,
  `metadata` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`host_id`) REFERENCES `agent_host`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_userId_idx` ON `agent` (`user_id`);
--> statement-breakpoint
CREATE INDEX `agent_hostId_idx` ON `agent` (`host_id`);
--> statement-breakpoint
CREATE INDEX `agent_status_idx` ON `agent` (`status`);
--> statement-breakpoint
CREATE INDEX `agent_kid_idx` ON `agent` (`kid`);
--> statement-breakpoint
CREATE TABLE `agent_capability_grant` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_id` text NOT NULL,
  `capability` text NOT NULL,
  `denied_by` text,
  `granted_by` text,
  `expires_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `reason` text,
  `constraints` text,
  FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`denied_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`granted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agentCapabilityGrant_agentId_idx` ON `agent_capability_grant` (`agent_id`);
--> statement-breakpoint
CREATE INDEX `agentCapabilityGrant_capability_idx` ON `agent_capability_grant` (`capability`);
--> statement-breakpoint
CREATE INDEX `agentCapabilityGrant_grantedBy_idx` ON `agent_capability_grant` (`granted_by`);
--> statement-breakpoint
CREATE INDEX `agentCapabilityGrant_status_idx` ON `agent_capability_grant` (`status`);
--> statement-breakpoint
CREATE TABLE `approval_request` (
  `id` text PRIMARY KEY NOT NULL,
  `method` text NOT NULL,
  `agent_id` text,
  `host_id` text,
  `user_id` text,
  `capabilities` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `user_code_hash` text,
  `login_hint` text,
  `binding_message` text,
  `client_notification_token` text,
  `client_notification_endpoint` text,
  `delivery_mode` text,
  `interval` integer NOT NULL,
  `last_polled_at` integer,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`host_id`) REFERENCES `agent_host`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `approvalRequest_agentId_idx` ON `approval_request` (`agent_id`);
--> statement-breakpoint
CREATE INDEX `approvalRequest_hostId_idx` ON `approval_request` (`host_id`);
--> statement-breakpoint
CREATE INDEX `approvalRequest_userId_idx` ON `approval_request` (`user_id`);
--> statement-breakpoint
CREATE INDEX `approvalRequest_status_idx` ON `approval_request` (`status`);
