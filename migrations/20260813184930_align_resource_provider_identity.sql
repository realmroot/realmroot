UPDATE `provider_connection`
SET `external_subject` = (
      SELECT pc.`external_subject`
      FROM `provider_resource_authorization` a
      JOIN `provider_credential` pc ON pc.`provider_resource_authorization_id` = a.`id`
      WHERE a.`provider_connection_id` = `provider_connection`.`id`
        AND a.`status` = 'active'
        AND pc.`status` = 'active'
    ),
    `display_name` = (
      SELECT pc.`display_name`
      FROM `provider_resource_authorization` a
      JOIN `provider_credential` pc ON pc.`provider_resource_authorization_id` = a.`id`
      WHERE a.`provider_connection_id` = `provider_connection`.`id`
        AND a.`status` = 'active'
        AND pc.`status` = 'active'
    ),
    `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `authentication_account_id` IS NULL
  AND `status` = 'active'
  AND 1 = (
    SELECT count(*)
    FROM `provider_resource_authorization` a
    JOIN `provider_credential` pc ON pc.`provider_resource_authorization_id` = a.`id`
    WHERE a.`provider_connection_id` = `provider_connection`.`id`
      AND a.`status` = 'active'
      AND pc.`status` = 'active'
  );
