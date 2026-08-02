DROP INDEX `role_key_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `role_key_unique` ON `role` (`key`);