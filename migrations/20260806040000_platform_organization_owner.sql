INSERT INTO `member` (`id`, `organization_id`, `user_id`, `role`, `created_at`, `updated_at`)
SELECT
  'member_platform_' || substr(`id`, 1, 16),
  'org_platform',
  `id`,
  'owner',
  cast(unixepoch('subsecond') * 1000 as integer),
  cast(unixepoch('subsecond') * 1000 as integer)
FROM `user`
WHERE EXISTS (SELECT 1 FROM `organization` WHERE `id` = 'org_platform')
  AND NOT EXISTS (SELECT 1 FROM `member` WHERE `organization_id` = 'org_platform')
ORDER BY ((',' || replace(`role`, ' ', '') || ',') LIKE '%,admin,%') DESC, `created_at` ASC
LIMIT 1;
--> statement-breakpoint
UPDATE `agent_audit_event`
SET `realm_owned` = 0, `owner_organization_id` = 'org_platform'
WHERE `realm_owned` = 1
  AND (
    `resource_id` IN (SELECT `id` FROM `api_resource` WHERE `owner_organization_id` = 'org_platform')
    OR `agent_identity_id` IN (SELECT `id` FROM `agent_identity` WHERE `owner_organization_id` = 'org_platform')
    OR `access_grant_id` IN (
      SELECT g.`id`
      FROM `agent_access_grant` g
      JOIN `agent_identity` i ON i.`id` = g.`agent_identity_id`
      WHERE i.`owner_organization_id` = 'org_platform'
    )
    OR `resource_connection_id` IN (
      SELECT `id` FROM `resource_account_connection` WHERE `owner_organization_id` = 'org_platform'
    )
    OR (json_valid(`metadata`) AND json_extract(`metadata`, '$.organizationId') = 'org_platform')
  );
--> statement-breakpoint
CREATE TABLE `__platform_organization_verifier` (
  `violations` integer NOT NULL CHECK (`violations` = 0)
);
--> statement-breakpoint
INSERT INTO `__platform_organization_verifier`
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM `organization` WHERE `id` = 'org_platform') AND EXISTS (SELECT 1 FROM `user`)
  THEN CASE WHEN (SELECT count(*) FROM `member` WHERE `organization_id` = 'org_platform' AND (',' || `role` || ',') LIKE '%,owner,%') > 0 THEN 0 ELSE 1 END
  ELSE 0
END;
--> statement-breakpoint
INSERT INTO `__platform_organization_verifier`
SELECT count(*)
FROM `agent_audit_event`
WHERE `realm_owned` = 1
  AND (
    `resource_id` IN (SELECT `id` FROM `api_resource` WHERE `owner_organization_id` = 'org_platform')
    OR `agent_identity_id` IN (SELECT `id` FROM `agent_identity` WHERE `owner_organization_id` = 'org_platform')
    OR `access_grant_id` IN (
      SELECT g.`id`
      FROM `agent_access_grant` g
      JOIN `agent_identity` i ON i.`id` = g.`agent_identity_id`
      WHERE i.`owner_organization_id` = 'org_platform'
    )
    OR `resource_connection_id` IN (
      SELECT `id` FROM `resource_account_connection` WHERE `owner_organization_id` = 'org_platform'
    )
    OR (json_valid(`metadata`) AND json_extract(`metadata`, '$.organizationId') = 'org_platform')
  );
--> statement-breakpoint
DROP TABLE `__platform_organization_verifier`;
