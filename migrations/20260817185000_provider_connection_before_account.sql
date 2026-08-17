UPDATE `provider_connection`
SET `display_name` = COALESCE(
	(
		SELECT NULLIF(TRIM(`user`.`name`), '')
		FROM `account`
		JOIN `user` ON `user`.`id` = `account`.`user_id`
		WHERE `account`.`id` = `provider_connection`.`authentication_account_id`
	),
	(
		SELECT NULLIF(TRIM(`user`.`email`), '')
		FROM `account`
		JOIN `user` ON `user`.`id` = `account`.`user_id`
		WHERE `account`.`id` = `provider_connection`.`authentication_account_id`
	),
	`display_name`
),
	`updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `authentication_account_id` IS NOT NULL
	AND `display_name` = `external_subject`
	AND EXISTS (
		SELECT 1
		FROM `account`
		JOIN `user` ON `user`.`id` = `account`.`user_id`
		WHERE `account`.`id` = `provider_connection`.`authentication_account_id`
			AND COALESCE(NULLIF(TRIM(`user`.`name`), ''), NULLIF(TRIM(`user`.`email`), '')) IS NOT NULL
	);--> statement-breakpoint
DROP TRIGGER IF EXISTS `account_provider_connection_subject_guard`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `account_provider_connection_prepare`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `account_provider_connection_insert`;--> statement-breakpoint
CREATE TRIGGER `account_provider_connection_prepare`
BEFORE INSERT ON `account`
WHEN NEW.`provider_id` <> 'credential'
	AND EXISTS (
		SELECT 1
		FROM `identity_provider_connector` connector
		WHERE connector.`provider_id` = NEW.`provider_id`
	)
BEGIN
	SELECT RAISE(ABORT, 'Provider account is already connected to another Realmroot account')
	WHERE EXISTS (
		SELECT 1
		FROM `provider_connection` connection
		JOIN `identity_provider_connector` connector ON connector.`id` = connection.`connector_id`
		WHERE connector.`provider_id` = NEW.`provider_id`
			AND connection.`external_subject` = NEW.`account_id`
			AND connection.`owner_user_id` <> NEW.`user_id`
			AND connection.`status` = 'active'
	);
	SELECT RAISE(ABORT, 'provider connection external subject mismatch')
	WHERE EXISTS (
		SELECT 1
		FROM `provider_connection` connection
		JOIN `identity_provider_connector` connector ON connector.`id` = connection.`connector_id`
		WHERE connector.`provider_id` = NEW.`provider_id`
			AND connection.`owner_user_id` = NEW.`user_id`
			AND connection.`status` = 'active'
			AND connection.`external_subject` <> NEW.`account_id`
	);
	SELECT RAISE(ABORT, 'provider connection already has an authentication account')
	WHERE EXISTS (
		SELECT 1
		FROM `provider_connection` connection
		JOIN `identity_provider_connector` connector ON connector.`id` = connection.`connector_id`
		WHERE connector.`provider_id` = NEW.`provider_id`
			AND connection.`owner_user_id` = NEW.`user_id`
			AND connection.`authentication_account_id` IS NOT NULL
	);
	INSERT OR IGNORE INTO `provider_connection` (
		`id`, `connector_id`, `owner_user_id`, `owner_organization_id`, `authentication_account_id`,
		`external_subject`, `display_name`, `status`, `created_at`, `updated_at`
	)
	SELECT
		'provconn_auth_' || NEW.`id`, connector.`id`, NEW.`user_id`, NULL, NULL,
		NEW.`account_id`,
		COALESCE(NULLIF(TRIM(`user`.`name`), ''), NULLIF(TRIM(`user`.`email`), ''), NEW.`account_id`),
		'active', NEW.`created_at`, NEW.`updated_at`
	FROM `identity_provider_connector` connector
	JOIN `user` ON `user`.`id` = NEW.`user_id`
	WHERE connector.`provider_id` = NEW.`provider_id`;
	UPDATE `provider_connection`
	SET `external_subject` = NEW.`account_id`,
		`display_name` = CASE
			WHEN `status` <> 'active' OR `display_name` = `external_subject`
			THEN COALESCE(
				(SELECT NULLIF(TRIM(`user`.`name`), '') FROM `user` WHERE `user`.`id` = NEW.`user_id`),
				(SELECT NULLIF(TRIM(`user`.`email`), '') FROM `user` WHERE `user`.`id` = NEW.`user_id`),
				NEW.`account_id`
			)
			ELSE `display_name`
		END,
		`status` = 'active',
		`updated_at` = NEW.`updated_at`
	WHERE `connector_id` = (
		SELECT connector.`id`
		FROM `identity_provider_connector` connector
		WHERE connector.`provider_id` = NEW.`provider_id`
	)
		AND `owner_user_id` = NEW.`user_id`;
	SELECT RAISE(ABORT, 'provider connection preparation failed')
	WHERE NOT EXISTS (
		SELECT 1
		FROM `provider_connection` connection
		JOIN `identity_provider_connector` connector ON connector.`id` = connection.`connector_id`
		WHERE connector.`provider_id` = NEW.`provider_id`
			AND connection.`owner_user_id` = NEW.`user_id`
			AND connection.`external_subject` = NEW.`account_id`
			AND connection.`status` = 'active'
	);
END;--> statement-breakpoint
CREATE TRIGGER `account_provider_connection_insert`
AFTER INSERT ON `account`
WHEN NEW.`provider_id` <> 'credential'
	AND EXISTS (
		SELECT 1
		FROM `identity_provider_connector` connector
		WHERE connector.`provider_id` = NEW.`provider_id`
	)
BEGIN
	UPDATE `provider_connection`
	SET `authentication_account_id` = NEW.`id`,
		`updated_at` = NEW.`updated_at`
	WHERE `connector_id` = (
		SELECT connector.`id`
		FROM `identity_provider_connector` connector
		WHERE connector.`provider_id` = NEW.`provider_id`
	)
		AND `owner_user_id` = NEW.`user_id`
		AND `external_subject` = NEW.`account_id`
		AND `status` = 'active';
	SELECT RAISE(ABORT, 'provider connection attachment failed')
	WHERE NOT EXISTS (
		SELECT 1
		FROM `provider_connection`
		WHERE `authentication_account_id` = NEW.`id`
	);
END;
