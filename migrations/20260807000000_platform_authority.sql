UPDATE `member`
SET
  `role` = CASE
    WHEN (',' || replace(`role`, ' ', '') || ',') LIKE '%,owner,%' THEN `role`
    ELSE `role` || ',owner'
  END,
  `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `organization_id` = 'org_platform'
  AND `user_id` IN (
    SELECT `id`
    FROM `user`
    WHERE (',' || replace(`role`, ' ', '') || ',') LIKE '%,admin,%'
  );
--> statement-breakpoint
INSERT INTO `member` (`id`, `organization_id`, `user_id`, `role`, `created_at`, `updated_at`)
SELECT
  'member_platform_admin_' || `id`,
  'org_platform',
  `id`,
  'owner',
  cast(unixepoch('subsecond') * 1000 as integer),
  cast(unixepoch('subsecond') * 1000 as integer)
FROM `user`
WHERE EXISTS (SELECT 1 FROM `organization` WHERE `id` = 'org_platform')
  AND (',' || replace(`role`, ' ', '') || ',') LIKE '%,admin,%'
  AND NOT EXISTS (
    SELECT 1
    FROM `member`
    WHERE `organization_id` = 'org_platform'
      AND `user_id` = `user`.`id`
  );
--> statement-breakpoint
UPDATE `api_resource`
SET `owner_organization_id` = 'org_platform'
WHERE `connector_id` IS NOT NULL
  AND `owner_organization_id` <> 'org_platform';
