CREATE TABLE `agent_signing_key` (
  `id` text PRIMARY KEY NOT NULL,
  `algorithm` text NOT NULL,
  `public_jwk` text NOT NULL,
  `encrypted_private_jwk` text NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
