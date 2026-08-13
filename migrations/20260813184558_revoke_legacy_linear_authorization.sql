UPDATE `resource_scope_entitlement`
SET `ended_at` = cast(unixepoch('subsecond') * 1000 as integer),
    `end_reason` = 'revoked',
    `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `ended_at` IS NULL
  AND `connection_id` IN (
    SELECT a.`id`
    FROM `provider_resource_authorization` a
    JOIN `api_resource` r ON r.`id` = a.`resource_id`
    WHERE r.`identifier` = 'linear'
  );
--> statement-breakpoint
UPDATE `provider_credential`
SET `status` = 'revoked',
    `revoked_at` = cast(unixepoch('subsecond') * 1000 as integer),
    `refresh_claim_id` = NULL,
    `refresh_claim_expires_at` = NULL,
    `authorization_details` = '[]',
    `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `provider_resource_authorization_id` IN (
  SELECT a.`id`
  FROM `provider_resource_authorization` a
  JOIN `api_resource` r ON r.`id` = a.`resource_id`
  WHERE r.`identifier` = 'linear'
);
--> statement-breakpoint
UPDATE `provider_resource_authorization`
SET `status` = 'revoked',
    `revoked_at` = cast(unixepoch('subsecond') * 1000 as integer),
    `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `resource_id` IN (
  SELECT `id` FROM `api_resource` WHERE `identifier` = 'linear'
);
--> statement-breakpoint
UPDATE `provider_connection`
SET `status` = 'revoked',
    `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `authentication_account_id` IS NULL
  AND `connector_id` IN (
    SELECT r.`connector_id`
    FROM `api_resource` r
    WHERE r.`identifier` = 'linear' AND r.`connector_id` IS NOT NULL
  );
