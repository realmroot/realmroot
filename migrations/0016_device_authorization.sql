CREATE TABLE `device_code` (
	`id` text PRIMARY KEY NOT NULL,
	`device_code` text NOT NULL,
	`user_code` text NOT NULL,
	`user_id` text,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`last_polled_at` integer,
	`polling_interval` integer,
	`client_id` text,
	`scope` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_code_device_code_unique` ON `device_code` (`device_code`);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_code_user_code_unique` ON `device_code` (`user_code`);
--> statement-breakpoint
CREATE INDEX `deviceCode_deviceCode_idx` ON `device_code` (`device_code`);
--> statement-breakpoint
CREATE INDEX `deviceCode_userCode_idx` ON `device_code` (`user_code`);
--> statement-breakpoint
CREATE INDEX `deviceCode_clientId_idx` ON `device_code` (`client_id`);
--> statement-breakpoint
CREATE INDEX `deviceCode_userId_idx` ON `device_code` (`user_id`);
--> statement-breakpoint
CREATE INDEX `deviceCode_expiresAt_idx` ON `device_code` (`expires_at`);
