UPDATE `external_token_lease`
SET `revoked_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `revoked_at` IS NULL
  AND EXISTS (
    SELECT 1
    FROM json_each(`external_token_lease`.`entitlement_ids`) AS `lease_entitlement`
    JOIN `resource_scope_entitlement` AS `entitlement`
      ON `entitlement`.`id` = `lease_entitlement`.`value`
    JOIN `api_resource` AS `resource`
      ON `resource`.`id` = `entitlement`.`resource_server_id`
    WHERE `entitlement`.`agent_identity_id` IS NOT NULL
      AND `entitlement`.`ended_at` IS NULL
      AND `resource`.`authorization_model` = 'external'
      AND NOT EXISTS (
        SELECT 1
        FROM `provider_resource_authorization` AS `authorization`
        JOIN `provider_connection` AS `connection`
          ON `connection`.`id` = `authorization`.`provider_connection_id`
        JOIN `provider_credential` AS `credential`
          ON `credential`.`provider_resource_authorization_id` = `authorization`.`id`
        WHERE `authorization`.`id` = `entitlement`.`connection_id`
          AND `authorization`.`resource_id` = `entitlement`.`resource_server_id`
          AND `authorization`.`status` = 'active'
          AND `connection`.`status` = 'active'
          AND `credential`.`status` = 'active'
      )
  );

UPDATE `resource_scope_entitlement`
SET `ended_at` = cast(unixepoch('subsecond') * 1000 as integer),
    `end_reason` = 'revoked',
    `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `agent_identity_id` IS NOT NULL
  AND `ended_at` IS NULL
  AND `resource_server_id` IN (
    SELECT `id` FROM `api_resource` WHERE `authorization_model` = 'external'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM `provider_resource_authorization` AS `authorization`
    JOIN `provider_connection` AS `connection`
      ON `connection`.`id` = `authorization`.`provider_connection_id`
    JOIN `provider_credential` AS `credential`
      ON `credential`.`provider_resource_authorization_id` = `authorization`.`id`
    WHERE `authorization`.`id` = `resource_scope_entitlement`.`connection_id`
      AND `authorization`.`resource_id` = `resource_scope_entitlement`.`resource_server_id`
      AND `authorization`.`status` = 'active'
      AND `connection`.`status` = 'active'
      AND `credential`.`status` = 'active'
  );
