CREATE TABLE `oauth_context_selection` (
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`reference_id` text NOT NULL,
	`selected_at` integer NOT NULL,
	PRIMARY KEY(`client_id`, `user_id`),
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauthContextSelection_userId_idx` ON `oauth_context_selection` (`user_id`);