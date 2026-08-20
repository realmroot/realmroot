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
      AND `resource`.`authorization_model` = 'native'
      AND json_array_length(`entitlement`.`authorization_details`) = 0
  );

UPDATE `resource_scope_entitlement`
SET `ended_at` = cast(unixepoch('subsecond') * 1000 as integer),
    `end_reason` = 'revoked',
    `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `agent_identity_id` IS NOT NULL
  AND `ended_at` IS NULL
  AND json_array_length(`authorization_details`) = 0
  AND `resource_server_id` IN (
    SELECT `id`
    FROM `api_resource`
    WHERE `authorization_model` = 'native'
  );
