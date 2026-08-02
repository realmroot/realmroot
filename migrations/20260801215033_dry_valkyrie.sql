UPDATE `application_consent`
SET `revoked_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `id` IN (
	SELECT `id`
	FROM (
		SELECT
			`id`,
			row_number() OVER (
				PARTITION BY `application_id`, `user_id`
				ORDER BY `granted_at` DESC, `id` DESC
			) AS `position`
		FROM `application_consent`
		WHERE `revoked_at` IS NULL
	)
	WHERE `position` > 1
);--> statement-breakpoint
DELETE FROM `oauth_consent`
WHERE `id` IN (
	SELECT `id`
	FROM (
		SELECT
			`id`,
			row_number() OVER (
				PARTITION BY `client_id`, `user_id`, `reference_id`
				ORDER BY `updated_at` DESC, `id` DESC
			) AS `position`
		FROM `oauth_consent`
		WHERE `user_id` IS NOT NULL
	)
	WHERE `position` > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `oauthConsent_clientUser_default_unique` ON `oauth_consent` (`client_id`,`user_id`) WHERE "oauth_consent"."user_id" is not null and "oauth_consent"."reference_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `oauthConsent_clientUserReference_unique` ON `oauth_consent` (`client_id`,`user_id`,`reference_id`) WHERE "oauth_consent"."user_id" is not null and "oauth_consent"."reference_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `applicationConsent_activeApplicationUser_unique` ON `application_consent` (`application_id`,`user_id`) WHERE "application_consent"."revoked_at" is null;
