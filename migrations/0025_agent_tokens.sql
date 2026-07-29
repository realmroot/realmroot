CREATE TABLE `agent_authority_grant` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_identity_id` text NOT NULL,
  `mode` text NOT NULL,
  `subject_type` text NOT NULL,
  `subject_id` text NOT NULL,
  `audience` text NOT NULL,
  `scopes` text NOT NULL,
  `constraints` text,
  `status` text DEFAULT 'active' NOT NULL,
  `granted_by_user_id` text NOT NULL,
  `expires_at` integer,
  `revoked_at` integer,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON DELETE restrict,
  FOREIGN KEY (`granted_by_user_id`) REFERENCES `user`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `agentAuthorityGrant_agentIdentityId_idx` ON `agent_authority_grant` (`agent_identity_id`);
--> statement-breakpoint
CREATE INDEX `agentAuthorityGrant_status_idx` ON `agent_authority_grant` (`status`);
--> statement-breakpoint
CREATE INDEX `agentAuthorityGrant_expiresAt_idx` ON `agent_authority_grant` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `agent_access_token` (
  `id` text PRIMARY KEY NOT NULL,
  `token_hash` text NOT NULL,
  `agent_identity_id` text NOT NULL,
  `binding_id` text NOT NULL,
  `protocol_agent_id` text NOT NULL,
  `grant_id` text NOT NULL,
  `subject_issuer` text NOT NULL,
  `subject` text NOT NULL,
  `actor` text NOT NULL,
  `audience` text NOT NULL,
  `scopes` text NOT NULL,
  `confirmation_jkt` text NOT NULL,
  `expires_at` integer NOT NULL,
  `revoked_at` integer,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON DELETE restrict,
  FOREIGN KEY (`binding_id`) REFERENCES `agent_identity_binding`(`id`) ON DELETE restrict,
  FOREIGN KEY (`protocol_agent_id`) REFERENCES `agent`(`id`) ON DELETE restrict,
  FOREIGN KEY (`grant_id`) REFERENCES `agent_authority_grant`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_access_token_token_hash_unique` ON `agent_access_token` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `agentAccessToken_agentIdentityId_idx` ON `agent_access_token` (`agent_identity_id`);
--> statement-breakpoint
CREATE INDEX `agentAccessToken_bindingId_idx` ON `agent_access_token` (`binding_id`);
--> statement-breakpoint
CREATE INDEX `agentAccessToken_grantId_idx` ON `agent_access_token` (`grant_id`);
--> statement-breakpoint
CREATE INDEX `agentAccessToken_expiresAt_idx` ON `agent_access_token` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `agent_dpop_jti` (
  `jti_hash` text PRIMARY KEY NOT NULL,
  `key_thumbprint` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agentDpopJti_expiresAt_idx` ON `agent_dpop_jti` (`expires_at`);
