UPDATE `application`
SET
  `resource_scopes` = json_insert(
    `resource_scopes`,
    '$[#]',
    json_object(
      'resourceServerId',
      (SELECT `id` FROM `api_resource` WHERE `identifier` = 'linear'),
      'scopes',
      json('["app:assignable","app:mentionable","comments:create","customer:read","customer:write","initiative:read","initiative:write","issues:create","read","timeSchedule:write","write"]')
    )
  ),
  `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `slug` = 'realmroot-adapters'
  AND EXISTS (SELECT 1 FROM `api_resource` WHERE `identifier` = 'linear')
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(`application`.`resource_scopes`) configured
    WHERE json_extract(configured.value, '$.resourceServerId') = (
      SELECT `id` FROM `api_resource` WHERE `identifier` = 'linear'
    )
  );--> statement-breakpoint

WITH requested(id, scope) AS (VALUES
  ('019ffa10-cf66-77ca-82d6-40a66f41bb0f', 'app:assignable'),
  ('019ffa10-cf66-77ca-82d6-444856af6425', 'app:mentionable'),
  ('019ffa10-cf66-77ca-82d6-4a813e6465a9', 'comments:create'),
  ('019ffa10-cf66-77ca-82d6-4d062c9961d6', 'customer:read'),
  ('019ffa10-cf66-77ca-82d6-53af2fda82c4', 'customer:write'),
  ('019ffa10-cf66-77ca-82d6-578635d8f118', 'initiative:read'),
  ('019ffa10-cf67-777a-95dd-50ddaaace03e', 'initiative:write'),
  ('019ffa10-cf67-777a-95dd-549f48afd49d', 'issues:create'),
  ('019ffa10-cf67-777a-95dd-5a2d94af9797', 'read'),
  ('019ffa10-cf67-777a-95dd-5f95491fc785', 'timeSchedule:write'),
  ('019ffa10-cf67-777a-95dd-60fff25972e6', 'write')
)
INSERT INTO `resource_scope_entitlement` (
  `id`, `application_id`, `resource_server_id`, `authorization_details`,
  `authorization_context_hash`, `scope`, `mode`, `created_at`, `updated_at`
)
SELECT
  requested.id,
  app.id,
  resource.id,
  '[]',
  '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
  requested.scope,
  'persistent',
  cast(unixepoch('subsecond') * 1000 as integer),
  cast(unixepoch('subsecond') * 1000 as integer)
FROM requested
JOIN `application` app ON app.`slug` = 'realmroot-adapters'
JOIN `api_resource` resource ON resource.`identifier` = 'linear'
WHERE NOT EXISTS (
  SELECT 1
  FROM `resource_scope_entitlement` entitlement
  WHERE entitlement.`application_id` = app.id
    AND entitlement.`resource_server_id` = resource.id
    AND entitlement.`authorization_context_hash` = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
    AND entitlement.`scope` = requested.scope
    AND entitlement.`ended_at` IS NULL
);
