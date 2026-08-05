ALTER TABLE `agent_audit_event` ADD `owner_user_id` text;--> statement-breakpoint
ALTER TABLE `agent_audit_event` ADD `owner_organization_id` text;--> statement-breakpoint
UPDATE `agent_audit_event`
SET
  `owner_user_id` = CASE
    WHEN `action` LIKE 'agent.%' THEN
      (SELECT `owner_user_id` FROM `agent_identity` WHERE `agent_identity`.`id` = `agent_audit_event`.`agent_identity_id`)
    WHEN `resource_connection_id` IS NOT NULL THEN
      (SELECT `owner_user_id` FROM `resource_account_connection` WHERE `resource_account_connection`.`id` = `agent_audit_event`.`resource_connection_id`)
    WHEN `resource_id` = 'res_realmroot' AND `access_grant_id` IS NOT NULL
      AND json_extract(
        (SELECT `authorization_details` FROM `agent_access_grant` WHERE `agent_access_grant`.`id` = `agent_audit_event`.`access_grant_id`),
        '$[0].authority'
      ) = 'account' THEN
      json_extract(
        (SELECT `authorization_details` FROM `agent_access_grant` WHERE `agent_access_grant`.`id` = `agent_audit_event`.`access_grant_id`),
        '$[0].id'
      )
    ELSE NULL
  END,
  `owner_organization_id` = CASE
    WHEN `action` LIKE 'agent.%' THEN
      (SELECT `owner_organization_id` FROM `agent_identity` WHERE `agent_identity`.`id` = `agent_audit_event`.`agent_identity_id`)
    WHEN `resource_connection_id` IS NOT NULL THEN
      (SELECT `owner_organization_id` FROM `resource_account_connection` WHERE `resource_account_connection`.`id` = `agent_audit_event`.`resource_connection_id`)
    WHEN `resource_id` = 'res_realmroot' AND `access_grant_id` IS NOT NULL
      AND json_extract(
        (SELECT `authorization_details` FROM `agent_access_grant` WHERE `agent_access_grant`.`id` = `agent_audit_event`.`access_grant_id`),
        '$[0].authority'
      ) = 'organization' THEN
      json_extract(
        (SELECT `authorization_details` FROM `agent_access_grant` WHERE `agent_access_grant`.`id` = `agent_audit_event`.`access_grant_id`),
        '$[0].id'
      )
    WHEN `resource_id` <> 'res_realmroot' THEN
      (SELECT `owner_organization_id` FROM `api_resource` WHERE `api_resource`.`id` = `agent_audit_event`.`resource_id`)
    ELSE NULL
  END,
  `metadata` = CASE
    WHEN `resource_id` = 'res_realmroot'
      AND `resource_connection_id` IS NULL
      AND (
        `access_grant_id` IS NULL
        OR coalesce(
          json_extract(
            (SELECT `authorization_details` FROM `agent_access_grant` WHERE `agent_access_grant`.`id` = `agent_audit_event`.`access_grant_id`),
            '$[0].authority'
          ),
          ''
        ) NOT IN ('realm', 'organization', 'account')
      ) THEN
      CASE
        WHEN json_valid(`metadata`) AND json_type(`metadata`) = 'object' THEN
          json_set(`metadata`, '$.ownerResolution', 'legacy-authority-unresolved')
        ELSE json_object('ownerResolution', 'legacy-authority-unresolved')
      END
    ELSE `metadata`
  END;--> statement-breakpoint
CREATE TRIGGER `agent_audit_event_owner_insert_guard`
BEFORE INSERT ON `agent_audit_event`
WHEN NEW.`owner_user_id` IS NOT NULL AND NEW.`owner_organization_id` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'agent_audit_event has multiple management owners');
END;--> statement-breakpoint
CREATE TRIGGER `agent_audit_event_owner_update_guard`
BEFORE UPDATE OF `owner_user_id`, `owner_organization_id` ON `agent_audit_event`
WHEN NEW.`owner_user_id` IS NOT NULL AND NEW.`owner_organization_id` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'agent_audit_event has multiple management owners');
END;--> statement-breakpoint
CREATE INDEX `agentAuditEvent_ownerUserId_idx` ON `agent_audit_event` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `agentAuditEvent_ownerOrganizationId_idx` ON `agent_audit_event` (`owner_organization_id`);
