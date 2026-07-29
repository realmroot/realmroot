PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_invitation` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `email` text NOT NULL,
  `role` text DEFAULT 'member' NOT NULL,
  `inviter_id` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `token_hash` text,
  `expires_at` integer NOT NULL,
  `accepted_at` integer,
  `revoked_at` integer,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_invitation` (
  `id`,
  `organization_id`,
  `email`,
  `role`,
  `inviter_id`,
  `status`,
  `token_hash`,
  `expires_at`,
  `accepted_at`,
  `revoked_at`,
  `created_at`
)
SELECT
  `id`,
  `organization_id`,
  `email`,
  `role`,
  `inviter_id`,
  `status`,
  `token_hash`,
  `expires_at`,
  `accepted_at`,
  `revoked_at`,
  `created_at`
FROM `invitation`;
--> statement-breakpoint
DROP TABLE `invitation`;
--> statement-breakpoint
ALTER TABLE `__new_invitation` RENAME TO `invitation`;
--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_token_hash_unique` ON `invitation` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);
--> statement-breakpoint
CREATE INDEX `invitation_inviterId_idx` ON `invitation` (`inviter_id`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
