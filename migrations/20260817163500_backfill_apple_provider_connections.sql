UPDATE `provider_connection`
SET `authentication_account_id` = (
	SELECT account.`id`
	FROM `account`
	JOIN `identity_provider_connector` connector
		ON connector.`provider_id` = account.`provider_id`
	WHERE account.`provider_id` = 'apple'
		AND connector.`id` = `provider_connection`.`connector_id`
		AND account.`user_id` = `provider_connection`.`owner_user_id`
		AND account.`account_id` = `provider_connection`.`external_subject`
	ORDER BY account.`created_at`, account.`id`
	LIMIT 1
),
	`status` = 'active'
WHERE `authentication_account_id` IS NULL
	AND EXISTS (
		SELECT 1
		FROM `account`
		JOIN `identity_provider_connector` connector
			ON connector.`provider_id` = account.`provider_id`
		WHERE account.`provider_id` = 'apple'
			AND connector.`id` = `provider_connection`.`connector_id`
			AND account.`user_id` = `provider_connection`.`owner_user_id`
			AND account.`account_id` = `provider_connection`.`external_subject`
	);--> statement-breakpoint
INSERT OR IGNORE INTO `provider_connection` (
	`id`,
	`connector_id`,
	`owner_user_id`,
	`owner_organization_id`,
	`authentication_account_id`,
	`external_subject`,
	`display_name`,
	`status`,
	`created_at`,
	`updated_at`
)
SELECT
	'provconn_auth_' || account.`id`,
	connector.`id`,
	account.`user_id`,
	NULL,
	account.`id`,
	account.`account_id`,
	account.`account_id`,
	'active',
	account.`created_at`,
	account.`updated_at`
FROM `account`
JOIN `identity_provider_connector` connector
	ON connector.`provider_id` = account.`provider_id`
WHERE account.`provider_id` = 'apple'
	AND NOT EXISTS (
		SELECT 1
		FROM `provider_connection` connection
		WHERE connection.`connector_id` = connector.`id`
			AND connection.`owner_user_id` = account.`user_id`
	);
