ALTER TABLE `user` ADD `username` text;--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);--> statement-breakpoint
ALTER TABLE `user` ADD `avatar_asset_id` text;
