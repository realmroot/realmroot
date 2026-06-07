CREATE TABLE `trusted_external_issuer` (
  `id` text PRIMARY KEY NOT NULL,
  `issuer` text NOT NULL,
  `name` text NOT NULL,
  `jwks_url` text,
  `shared_secret` text,
  `allowed_audiences` text,
  `enabled` integer DEFAULT true NOT NULL,
  `metadata` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trustedExternalIssuer_issuer_unique` ON `trusted_external_issuer` (`issuer`);
--> statement-breakpoint
CREATE INDEX `trustedExternalIssuer_enabled_idx` ON `trusted_external_issuer` (`enabled`);
--> statement-breakpoint
CREATE TABLE `token_exchange_access_token` (
  `id` text PRIMARY KEY NOT NULL,
  `token_hash` text NOT NULL,
  `client_id` text NOT NULL,
  `issuer_id` text NOT NULL,
  `subject` text NOT NULL,
  `subject_token_issuer` text NOT NULL,
  `audience` text NOT NULL,
  `scopes` text NOT NULL,
  `claims` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `revoked_at` integer,
  FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`issuer_id`) REFERENCES `trusted_external_issuer`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `token_exchange_access_token_token_hash_unique` ON `token_exchange_access_token` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `tokenExchangeAccessToken_clientId_idx` ON `token_exchange_access_token` (`client_id`);
--> statement-breakpoint
CREATE INDEX `tokenExchangeAccessToken_issuerId_idx` ON `token_exchange_access_token` (`issuer_id`);
--> statement-breakpoint
CREATE INDEX `tokenExchangeAccessToken_expiresAt_idx` ON `token_exchange_access_token` (`expires_at`);
