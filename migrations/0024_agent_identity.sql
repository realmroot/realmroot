CREATE TABLE `agent_identity` (
  `id` text PRIMARY KEY NOT NULL,
  `issuer` text NOT NULL,
  `subject` text NOT NULL,
  `name` text NOT NULL,
  `owner_user_id` text,
  `owner_organization_id` text,
  `status` text DEFAULT 'active' NOT NULL,
  `retired_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `agentIdentity_exactly_one_owner_check`
    CHECK ((`owner_user_id` IS NOT NULL) + (`owner_organization_id` IS NOT NULL) = 1),
  FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`owner_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agentIdentity_issuer_subject_unique` ON `agent_identity` (`issuer`, `subject`);
--> statement-breakpoint
CREATE INDEX `agentIdentity_ownerUserId_idx` ON `agent_identity` (`owner_user_id`);
--> statement-breakpoint
CREATE INDEX `agentIdentity_ownerOrganizationId_idx` ON `agent_identity` (`owner_organization_id`);
--> statement-breakpoint
CREATE INDEX `agentIdentity_status_idx` ON `agent_identity` (`status`);
--> statement-breakpoint
CREATE TABLE `agent_identity_binding` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_identity_id` text NOT NULL,
  `protocol_agent_id` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `bound_at` integer NOT NULL,
  `revoked_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`protocol_agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agentIdentityBinding_protocolAgentId_unique`
  ON `agent_identity_binding` (`protocol_agent_id`);
--> statement-breakpoint
CREATE INDEX `agentIdentityBinding_agentIdentityId_idx`
  ON `agent_identity_binding` (`agent_identity_id`);
--> statement-breakpoint
CREATE INDEX `agentIdentityBinding_status_idx` ON `agent_identity_binding` (`status`);
--> statement-breakpoint
CREATE TABLE `agent_enrollment_intent` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_identity_id` text,
  `requested_name` text,
  `owner_user_id` text,
  `owner_organization_id` text,
  `protocol_agent_id` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `created_by_user_id` text NOT NULL,
  `approved_by_user_id` text,
  `expires_at` integer NOT NULL,
  `approved_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `agentEnrollmentIntent_exactly_one_owner_check`
    CHECK ((`owner_user_id` IS NOT NULL) + (`owner_organization_id` IS NOT NULL) = 1),
  CONSTRAINT `agentEnrollmentIntent_new_or_existing_identity_check`
    CHECK ((`agent_identity_id` IS NOT NULL) OR (`requested_name` IS NOT NULL)),
  FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`owner_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`protocol_agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`approved_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `agentEnrollmentIntent_agentIdentityId_idx`
  ON `agent_enrollment_intent` (`agent_identity_id`);
--> statement-breakpoint
CREATE INDEX `agentEnrollmentIntent_protocolAgentId_idx`
  ON `agent_enrollment_intent` (`protocol_agent_id`);
--> statement-breakpoint
CREATE INDEX `agentEnrollmentIntent_status_idx` ON `agent_enrollment_intent` (`status`);
--> statement-breakpoint
CREATE INDEX `agentEnrollmentIntent_expiresAt_idx` ON `agent_enrollment_intent` (`expires_at`);
