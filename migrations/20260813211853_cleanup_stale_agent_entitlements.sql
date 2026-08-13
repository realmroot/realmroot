UPDATE `resource_scope_entitlement`
SET `ended_at` = cast(unixepoch('subsecond') * 1000 as integer),
    `end_reason` = 'revoked',
    `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `ended_at` IS NULL
  AND (
    EXISTS (
      SELECT 1
      FROM json_each(`resource_scope_entitlement`.`authorization_details`) AS `detail`
      WHERE json_extract(`detail`.`value`, '$.type') = 'realmroot_authority'
        AND json_extract(`detail`.`value`, '$.id') = 'org_platform'
    )
    OR (
      `agent_identity_id` IS NOT NULL
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
          AND EXISTS (
            SELECT 1
            FROM json_each(`credential`.`granted_scopes`) AS `granted_scope`
            WHERE `granted_scope`.`value` = `resource_scope_entitlement`.`scope`
          )
      )
    )
  );
