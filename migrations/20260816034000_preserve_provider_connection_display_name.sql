DROP TRIGGER IF EXISTS `account_provider_connection_insert`;--> statement-breakpoint
CREATE TRIGGER `account_provider_connection_insert`
AFTER INSERT ON `account`
WHEN NEW.`provider_id` <> 'credential'
BEGIN
	INSERT OR IGNORE INTO `provider_connection` (
		`id`, `connector_id`, `owner_user_id`, `owner_organization_id`, `authentication_account_id`,
		`external_subject`, `display_name`, `status`, `created_at`, `updated_at`
	)
	SELECT
		'provconn_auth_' || NEW.`id`, c.`id`, NEW.`user_id`, NULL, NEW.`id`,
		NEW.`account_id`, NEW.`account_id`, 'active', NEW.`created_at`, NEW.`updated_at`
	FROM `identity_provider_connector` c
	WHERE c.`provider_id` = NEW.`provider_id`;
	UPDATE `provider_connection`
	SET `authentication_account_id` = NEW.`id`,
		`status` = 'active',
		`updated_at` = NEW.`updated_at`
	WHERE `connector_id` = (
		SELECT `id` FROM `identity_provider_connector` WHERE `provider_id` = NEW.`provider_id`
	)
		AND `owner_user_id` = NEW.`user_id`;
END;--> statement-breakpoint
UPDATE `provider_connection`
SET `display_name` = (
	SELECT credential.`display_name`
	FROM `provider_resource_authorization` authorization
	JOIN `provider_credential` credential
		ON credential.`provider_resource_authorization_id` = authorization.`id`
	WHERE authorization.`provider_connection_id` = `provider_connection`.`id`
		AND authorization.`status` = 'active'
		AND credential.`status` = 'active'
		AND credential.`external_subject` = `provider_connection`.`external_subject`
		AND credential.`display_name` <> credential.`external_subject`
	ORDER BY credential.`updated_at` DESC
	LIMIT 1
),
	`updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `authentication_account_id` IS NOT NULL
	AND `display_name` = `external_subject`
	AND EXISTS (
		SELECT 1
		FROM `provider_resource_authorization` authorization
		JOIN `provider_credential` credential
			ON credential.`provider_resource_authorization_id` = authorization.`id`
		WHERE authorization.`provider_connection_id` = `provider_connection`.`id`
			AND authorization.`status` = 'active'
			AND credential.`status` = 'active'
			AND credential.`external_subject` = `provider_connection`.`external_subject`
			AND credential.`display_name` <> credential.`external_subject`
	);
