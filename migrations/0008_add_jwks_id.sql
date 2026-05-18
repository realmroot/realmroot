ALTER TABLE `jwks` RENAME TO `jwks_legacy`;

CREATE TABLE `jwks` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer
);

INSERT INTO `jwks` (`id`, `public_key`, `private_key`, `created_at`, `expires_at`)
SELECT 'jwks_' || lower(hex(randomblob(16))), `public_key`, `private_key`, `created_at`, `expires_at`
FROM `jwks_legacy`;

DROP TABLE `jwks_legacy`;
