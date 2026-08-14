UPDATE `resource_scope_entitlement` AS `legacy`
SET `connection_id` = (
      SELECT `current`.`connection_id`
      FROM `resource_scope_entitlement` AS `current`,
           json_each(`current`.`authorization_details`) AS `current_detail`,
           json_each(`legacy`.`authorization_details`) AS `legacy_detail`
      WHERE `current`.`agent_identity_id` = `legacy`.`agent_identity_id`
        AND `current`.`resource_server_id` = `legacy`.`resource_server_id`
        AND `current`.`connection_id` IS NOT NULL
        AND json_extract(`current_detail`.`value`, '$.type') =
          'https://adapters.realmroot.dev/authorization-details/github-installation'
        AND json_extract(`legacy_detail`.`value`, '$.type') = 'github_installation'
        AND json_extract(`current_detail`.`value`, '$.installation_id') =
          json_extract(`legacy_detail`.`value`, '$.installation_id')
      ORDER BY `current`.`created_at` DESC
      LIMIT 1
    ),
    `authorization_details` = json_set(
      `legacy`.`authorization_details`,
      '$[0].type',
      'https://adapters.realmroot.dev/authorization-details/github-installation'
    ),
    `authorization_context_hash` = (
      SELECT `current`.`authorization_context_hash`
      FROM `resource_scope_entitlement` AS `current`,
           json_each(`current`.`authorization_details`) AS `current_detail`,
           json_each(`legacy`.`authorization_details`) AS `legacy_detail`
      WHERE `current`.`agent_identity_id` = `legacy`.`agent_identity_id`
        AND `current`.`resource_server_id` = `legacy`.`resource_server_id`
        AND `current`.`connection_id` IS NOT NULL
        AND json_extract(`current_detail`.`value`, '$.type') =
          'https://adapters.realmroot.dev/authorization-details/github-installation'
        AND json_extract(`legacy_detail`.`value`, '$.type') = 'github_installation'
        AND json_extract(`current_detail`.`value`, '$.installation_id') =
          json_extract(`legacy_detail`.`value`, '$.installation_id')
      ORDER BY `current`.`created_at` DESC
      LIMIT 1
    ),
    `ended_at` = NULL,
    `end_reason` = NULL,
    `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `legacy`.`agent_identity_id` IS NOT NULL
  AND `legacy`.`mode` = 'persistent'
  AND `legacy`.`ended_at` IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM json_each(`legacy`.`authorization_details`) AS `legacy_detail`
    WHERE json_extract(`legacy_detail`.`value`, '$.type') = 'github_installation'
  )
  AND `legacy`.`id` = (
    SELECT `candidate`.`id`
    FROM `resource_scope_entitlement` AS `candidate`,
         json_each(`candidate`.`authorization_details`) AS `candidate_detail`,
         json_each(`legacy`.`authorization_details`) AS `legacy_detail`
    WHERE `candidate`.`agent_identity_id` = `legacy`.`agent_identity_id`
      AND `candidate`.`resource_server_id` = `legacy`.`resource_server_id`
      AND `candidate`.`scope` = `legacy`.`scope`
      AND `candidate`.`mode` = 'persistent'
      AND json_extract(`candidate_detail`.`value`, '$.type') = 'github_installation'
      AND json_extract(`legacy_detail`.`value`, '$.type') = 'github_installation'
      AND json_extract(`candidate_detail`.`value`, '$.installation_id') =
        json_extract(`legacy_detail`.`value`, '$.installation_id')
    ORDER BY `candidate`.`created_at` DESC, `candidate`.`id` DESC
    LIMIT 1
  )
  AND EXISTS (
    SELECT 1
    FROM `resource_scope_entitlement` AS `current`,
         json_each(`current`.`authorization_details`) AS `current_detail`,
         json_each(`legacy`.`authorization_details`) AS `legacy_detail`
    WHERE `current`.`agent_identity_id` = `legacy`.`agent_identity_id`
      AND `current`.`resource_server_id` = `legacy`.`resource_server_id`
      AND `current`.`connection_id` IS NOT NULL
      AND json_extract(`current_detail`.`value`, '$.type') =
        'https://adapters.realmroot.dev/authorization-details/github-installation'
      AND json_extract(`legacy_detail`.`value`, '$.type') = 'github_installation'
      AND json_extract(`current_detail`.`value`, '$.installation_id') =
        json_extract(`legacy_detail`.`value`, '$.installation_id')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM `resource_scope_entitlement` AS `active`,
         json_each(`active`.`authorization_details`) AS `active_detail`,
         json_each(`legacy`.`authorization_details`) AS `legacy_detail`
    WHERE `active`.`agent_identity_id` = `legacy`.`agent_identity_id`
      AND `active`.`resource_server_id` = `legacy`.`resource_server_id`
      AND `active`.`scope` = `legacy`.`scope`
      AND `active`.`ended_at` IS NULL
      AND json_extract(`active_detail`.`value`, '$.type') =
        'https://adapters.realmroot.dev/authorization-details/github-installation'
      AND json_extract(`legacy_detail`.`value`, '$.type') = 'github_installation'
      AND json_extract(`active_detail`.`value`, '$.installation_id') =
        json_extract(`legacy_detail`.`value`, '$.installation_id')
  );
