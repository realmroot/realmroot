ALTER TABLE `agent_authority_grant` ADD `use_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `agent_authority_approval` (
  `id` text PRIMARY KEY NOT NULL,
  `grant_id` text NOT NULL,
  `binding_id` text NOT NULL,
  `requested_scopes` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `approved_by_user_id` text,
  `expires_at` integer NOT NULL,
  `approved_at` integer,
  `consumed_at` integer,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`grant_id`) REFERENCES `agent_authority_grant`(`id`) ON DELETE restrict,
  FOREIGN KEY (`binding_id`) REFERENCES `agent_identity_binding`(`id`) ON DELETE restrict,
  FOREIGN KEY (`approved_by_user_id`) REFERENCES `user`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `agentAuthorityApproval_grantId_idx` ON `agent_authority_approval` (`grant_id`);
--> statement-breakpoint
CREATE INDEX `agentAuthorityApproval_status_idx` ON `agent_authority_approval` (`status`);
--> statement-breakpoint
CREATE INDEX `agentAuthorityApproval_expiresAt_idx` ON `agent_authority_approval` (`expires_at`);
