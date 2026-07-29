CREATE TABLE `token_exchange_refresh_token` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`client_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`subject` text NOT NULL,
	`subject_token_issuer` text NOT NULL,
	`audience` text NOT NULL,
	`scopes` text NOT NULL,
	`claims` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `federated_credential`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `token_exchange_refresh_token_token_hash_unique` ON `token_exchange_refresh_token` (`token_hash`);--> statement-breakpoint
CREATE INDEX `tokenExchangeRefreshToken_familyId_idx` ON `token_exchange_refresh_token` (`family_id`);--> statement-breakpoint
CREATE INDEX `tokenExchangeRefreshToken_clientId_idx` ON `token_exchange_refresh_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `tokenExchangeRefreshToken_credentialId_idx` ON `token_exchange_refresh_token` (`credential_id`);--> statement-breakpoint
CREATE INDEX `tokenExchangeRefreshToken_expiresAt_idx` ON `token_exchange_refresh_token` (`expires_at`);--> statement-breakpoint
ALTER TABLE `federated_credential` DROP COLUMN `shared_secret`;