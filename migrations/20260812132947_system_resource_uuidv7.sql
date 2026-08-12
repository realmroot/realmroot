PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__system_identifier_migration` (
  `kind` text PRIMARY KEY,
  `old_id` text NOT NULL,
  `new_id` text NOT NULL
);--> statement-breakpoint
INSERT INTO `__system_identifier_migration` (`kind`, `old_id`, `new_id`)
SELECT
  'organization',
  'org_platform',
  coalesce(
    (SELECT `id` FROM `organization` WHERE `slug` = 'realmroot' AND `id` <> 'org_platform' LIMIT 1),
    lower(printf(
      '%08x-%04x-7%s-8%s-%s',
      cast(unixepoch('subsecond') * 1000 as integer) >> 16,
      cast(unixepoch('subsecond') * 1000 as integer) & 65535,
      substr(hex(randomblob(9)), 1, 3),
      substr(hex(randomblob(9)), 4, 3),
      substr(hex(randomblob(9)), 7, 12)
    ))
  )
WHERE EXISTS (SELECT 1 FROM `organization` WHERE `id` = 'org_platform');--> statement-breakpoint
INSERT INTO `__system_identifier_migration` (`kind`, `old_id`, `new_id`)
SELECT
  'resource_server',
  'res_realmroot',
  lower(printf(
    '%08x-%04x-7%s-8%s-%s',
    cast(unixepoch('subsecond') * 1000 as integer) >> 16,
    cast(unixepoch('subsecond') * 1000 as integer) & 65535,
    substr(hex(randomblob(9)), 1, 3),
    substr(hex(randomblob(9)), 4, 3),
    substr(hex(randomblob(9)), 7, 12)
  ))
WHERE EXISTS (SELECT 1 FROM `api_resource` WHERE `id` = 'res_realmroot');--> statement-breakpoint

UPDATE `member` SET `organization_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization') WHERE `organization_id` = 'org_platform';--> statement-breakpoint
UPDATE `invitation` SET `organization_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization') WHERE `organization_id` = 'org_platform';--> statement-breakpoint
UPDATE `application` SET `owner_organization_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization') WHERE `owner_organization_id` = 'org_platform';--> statement-breakpoint
UPDATE `api_resource` SET `owner_organization_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization') WHERE `owner_organization_id` = 'org_platform';--> statement-breakpoint
UPDATE `organization_role` SET `organization_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization') WHERE `organization_id` = 'org_platform';--> statement-breakpoint
UPDATE `provider_connection` SET `owner_organization_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization') WHERE `owner_organization_id` = 'org_platform';--> statement-breakpoint
UPDATE `resource_connection_intent` SET `owner_organization_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization') WHERE `owner_organization_id` = 'org_platform';--> statement-breakpoint
UPDATE `agent_identity` SET `owner_organization_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization') WHERE `owner_organization_id` = 'org_platform';--> statement-breakpoint
UPDATE `agent_enrollment_intent` SET `owner_organization_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization') WHERE `owner_organization_id` = 'org_platform';--> statement-breakpoint
UPDATE `webhook_endpoint` SET `organization_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization') WHERE `organization_id` = 'org_platform';--> statement-breakpoint
UPDATE `branding_setting` SET `organization_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization') WHERE `organization_id` = 'org_platform';--> statement-breakpoint
UPDATE `custom_domain` SET `organization_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization') WHERE `organization_id` = 'org_platform';--> statement-breakpoint
UPDATE `resource_scope_entitlement` SET `organization_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization') WHERE `organization_id` = 'org_platform';--> statement-breakpoint
UPDATE `session` SET `active_organization_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization') WHERE `active_organization_id` = 'org_platform';--> statement-breakpoint
UPDATE `agent_audit_event` SET `owner_organization_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization') WHERE `owner_organization_id` = 'org_platform';--> statement-breakpoint
UPDATE `agent_audit_event`
SET `metadata` = json_set(`metadata`, '$.organizationId', (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization'))
WHERE json_valid(`metadata`) AND json_extract(`metadata`, '$.organizationId') = 'org_platform';--> statement-breakpoint
DELETE FROM `organization`
WHERE `id` = 'org_platform'
  AND EXISTS (
    SELECT 1
    FROM `organization` AS `replacement`
    WHERE `replacement`.`id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization')
  );--> statement-breakpoint
UPDATE `organization`
SET `id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'organization'), `slug` = 'realmroot'
WHERE `id` = 'org_platform';--> statement-breakpoint
UPDATE `organization` SET `slug` = 'realmroot' WHERE `slug` = 'realmroot-platform';--> statement-breakpoint

UPDATE `application_consent` SET `resource_server_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'resource_server') WHERE `resource_server_id` = 'res_realmroot';--> statement-breakpoint
UPDATE `federated_credential` SET `audience_resource_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'resource_server') WHERE `audience_resource_id` = 'res_realmroot';--> statement-breakpoint
UPDATE `provider_resource_authorization` SET `resource_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'resource_server') WHERE `resource_id` = 'res_realmroot';--> statement-breakpoint
UPDATE `resource_connection_intent` SET `resource_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'resource_server') WHERE `resource_id` = 'res_realmroot';--> statement-breakpoint
UPDATE `agent_connection_request` SET `resource_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'resource_server') WHERE `resource_id` = 'res_realmroot';--> statement-breakpoint
UPDATE `agent_access_request` SET `resource_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'resource_server') WHERE `resource_id` = 'res_realmroot';--> statement-breakpoint
UPDATE `resource_scope_entitlement` SET `resource_server_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'resource_server') WHERE `resource_server_id` = 'res_realmroot';--> statement-breakpoint
UPDATE `agent_audit_event` SET `resource_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'resource_server') WHERE `resource_id` = 'res_realmroot';--> statement-breakpoint
UPDATE `oauth_client` SET `reference_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'resource_server') WHERE `reference_id` = 'res_realmroot';--> statement-breakpoint
UPDATE `oauth_refresh_token` SET `reference_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'resource_server') WHERE `reference_id` = 'res_realmroot';--> statement-breakpoint
UPDATE `oauth_access_token` SET `reference_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'resource_server') WHERE `reference_id` = 'res_realmroot';--> statement-breakpoint
UPDATE `oauth_consent` SET `reference_id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'resource_server') WHERE `reference_id` = 'res_realmroot';--> statement-breakpoint
UPDATE `application`
SET `resource_scopes` = (
  SELECT json_group_array(json(json_set(`value`, '$.resourceServerId', (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'resource_server'))))
  FROM json_each(`application`.`resource_scopes`)
)
WHERE EXISTS (
  SELECT 1 FROM json_each(`application`.`resource_scopes`)
  WHERE json_extract(`value`, '$.resourceServerId') = 'res_realmroot'
);--> statement-breakpoint
UPDATE `organization_role`
SET `permission` = json_set(
  `permission`,
  '$.scope',
  json((
    SELECT json_group_array(
      CASE
        WHEN `value` LIKE 'res_realmroot/%'
          THEN (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'resource_server') || substr(`value`, length('res_realmroot') + 1)
        ELSE `value`
      END
    )
    FROM json_each(json_extract(`organization_role`.`permission`, '$.scope'))
  ))
)
WHERE EXISTS (
  SELECT 1 FROM json_each(json_extract(`organization_role`.`permission`, '$.scope'))
  WHERE `value` LIKE 'res_realmroot/%'
);--> statement-breakpoint
UPDATE `api_resource`
SET `id` = (SELECT `new_id` FROM `__system_identifier_migration` WHERE `kind` = 'resource_server')
WHERE `id` = 'res_realmroot';--> statement-breakpoint

DROP TABLE `__system_identifier_migration`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
