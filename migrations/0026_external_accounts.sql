ALTER TABLE `identity_provider_connector` ADD `api_base_url` text;
--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `credential_modes` text;
--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `credential_header_name` text;
--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `allowed_methods` text;
--> statement-breakpoint
ALTER TABLE `identity_provider_connector` ADD `allowed_path_prefixes` text;
--> statement-breakpoint
CREATE TABLE `external_account` (
  `id` text PRIMARY KEY NOT NULL,
  `connector_id` text NOT NULL,
  `owner_user_id` text,
  `owner_organization_id` text,
  `owner_agent_identity_id` text,
  `external_subject` text,
  `display_name` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `metadata` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  CONSTRAINT `externalAccount_exactly_one_owner_check`
    CHECK (((`owner_user_id` IS NOT NULL) + (`owner_organization_id` IS NOT NULL) + (`owner_agent_identity_id` IS NOT NULL)) = 1),
  FOREIGN KEY (`connector_id`) REFERENCES `identity_provider_connector`(`id`) ON DELETE restrict,
  FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON DELETE restrict,
  FOREIGN KEY (`owner_organization_id`) REFERENCES `organization`(`id`) ON DELETE restrict,
  FOREIGN KEY (`owner_agent_identity_id`) REFERENCES `agent_identity`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `externalAccount_connectorId_idx` ON `external_account` (`connector_id`);
--> statement-breakpoint
CREATE INDEX `externalAccount_ownerUserId_idx` ON `external_account` (`owner_user_id`);
--> statement-breakpoint
CREATE INDEX `externalAccount_ownerOrganizationId_idx` ON `external_account` (`owner_organization_id`);
--> statement-breakpoint
CREATE INDEX `externalAccount_ownerAgentIdentityId_idx` ON `external_account` (`owner_agent_identity_id`);
--> statement-breakpoint
CREATE INDEX `externalAccount_status_idx` ON `external_account` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `externalAccount_connectorId_externalSubject_unique`
  ON `external_account` (`connector_id`, `external_subject`);
--> statement-breakpoint
CREATE TABLE `external_credential` (
  `id` text PRIMARY KEY NOT NULL,
  `external_account_id` text NOT NULL,
  `kind` text NOT NULL,
  `encrypted_payload` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `expires_at` integer,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`external_account_id`) REFERENCES `external_account`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `externalCredential_externalAccountId_unique`
  ON `external_credential` (`external_account_id`);
--> statement-breakpoint
CREATE INDEX `externalCredential_status_idx` ON `external_credential` (`status`);
--> statement-breakpoint
CREATE INDEX `externalCredential_expiresAt_idx` ON `external_credential` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `external_account_grant` (
  `id` text PRIMARY KEY NOT NULL,
  `external_account_id` text NOT NULL,
  `agent_identity_id` text NOT NULL,
  `scopes` text NOT NULL,
  `allowed_methods` text NOT NULL,
  `allowed_path_prefixes` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `granted_by_user_id` text NOT NULL,
  `expires_at` integer,
  `revoked_at` integer,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`external_account_id`) REFERENCES `external_account`(`id`) ON DELETE restrict,
  FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON DELETE restrict,
  FOREIGN KEY (`granted_by_user_id`) REFERENCES `user`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `externalAccountGrant_account_agent_unique`
  ON `external_account_grant` (`external_account_id`, `agent_identity_id`);
--> statement-breakpoint
CREATE INDEX `externalAccountGrant_agentIdentityId_idx` ON `external_account_grant` (`agent_identity_id`);
--> statement-breakpoint
CREATE INDEX `externalAccountGrant_status_idx` ON `external_account_grant` (`status`);
--> statement-breakpoint
CREATE TABLE `external_oauth_intent` (
  `id` text PRIMARY KEY NOT NULL,
  `state_hash` text NOT NULL,
  `connector_id` text NOT NULL,
  `owner_user_id` text NOT NULL,
  `agent_identity_id` text,
  `owner_organization_id` text,
  `display_name` text NOT NULL,
  `scopes` text NOT NULL,
  `encrypted_pkce_verifier` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `expires_at` integer NOT NULL,
  `completed_at` integer,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`connector_id`) REFERENCES `identity_provider_connector`(`id`) ON DELETE restrict,
  FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON DELETE restrict,
  FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON DELETE restrict,
  FOREIGN KEY (`owner_organization_id`) REFERENCES `organization`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_oauth_intent_state_hash_unique` ON `external_oauth_intent` (`state_hash`);
--> statement-breakpoint
CREATE INDEX `externalOAuthIntent_connectorId_idx` ON `external_oauth_intent` (`connector_id`);
--> statement-breakpoint
CREATE INDEX `externalOAuthIntent_ownerUserId_idx` ON `external_oauth_intent` (`owner_user_id`);
--> statement-breakpoint
CREATE INDEX `externalOAuthIntent_ownerOrganizationId_idx` ON `external_oauth_intent` (`owner_organization_id`);
--> statement-breakpoint
CREATE INDEX `externalOAuthIntent_status_idx` ON `external_oauth_intent` (`status`);
--> statement-breakpoint
CREATE INDEX `externalOAuthIntent_expiresAt_idx` ON `external_oauth_intent` (`expires_at`);
