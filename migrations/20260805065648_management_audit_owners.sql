ALTER TABLE `agent_audit_event` ADD `owner_kind` text;--> statement-breakpoint
ALTER TABLE `agent_audit_event` ADD `owner_id` text;--> statement-breakpoint
ALTER TABLE `agent_audit_event` ADD `quarantine_reason` text;--> statement-breakpoint

UPDATE `agent_audit_event`
SET
  `owner_kind` = CASE
    WHEN `resource_connection_id` IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM `resource_account_connection`
        WHERE `id` = `agent_audit_event`.`resource_connection_id`
          AND ((`owner_user_id` IS NOT NULL) + (`owner_organization_id` IS NOT NULL)) = 1
      )
      THEN CASE
        WHEN (SELECT `owner_user_id` FROM `resource_account_connection` WHERE `id` = `agent_audit_event`.`resource_connection_id`) IS NOT NULL
          THEN 'account'
        ELSE 'organization'
      END
    WHEN `action` LIKE 'agent.%' AND `agent_identity_id` IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM `agent_identity`
        WHERE `id` = `agent_audit_event`.`agent_identity_id`
          AND ((`owner_user_id` IS NOT NULL) + (`owner_organization_id` IS NOT NULL)) = 1
      )
      THEN CASE
        WHEN (SELECT `owner_user_id` FROM `agent_identity` WHERE `id` = `agent_audit_event`.`agent_identity_id`) IS NOT NULL
          THEN 'account'
        ELSE 'organization'
      END
    ELSE NULL
  END,
  `owner_id` = CASE
    WHEN `resource_connection_id` IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM `resource_account_connection`
        WHERE `id` = `agent_audit_event`.`resource_connection_id`
          AND ((`owner_user_id` IS NOT NULL) + (`owner_organization_id` IS NOT NULL)) = 1
      )
      THEN coalesce(
        (SELECT `owner_user_id` FROM `resource_account_connection` WHERE `id` = `agent_audit_event`.`resource_connection_id`),
        (SELECT `owner_organization_id` FROM `resource_account_connection` WHERE `id` = `agent_audit_event`.`resource_connection_id`)
      )
    WHEN `action` LIKE 'agent.%' AND `agent_identity_id` IS NOT NULL
      THEN coalesce(
        (SELECT `owner_user_id` FROM `agent_identity` WHERE `id` = `agent_audit_event`.`agent_identity_id`),
        (SELECT `owner_organization_id` FROM `agent_identity` WHERE `id` = `agent_audit_event`.`agent_identity_id`)
      )
    ELSE NULL
  END;--> statement-breakpoint

UPDATE `agent_audit_event`
SET `owner_kind` = NULL, `owner_id` = NULL, `quarantine_reason` = 'owner_unresolved'
WHERE `owner_kind` IS NULL OR `owner_id` IS NULL
   OR (`owner_kind` = 'account' AND NOT EXISTS (SELECT 1 FROM `user` WHERE `id` = `agent_audit_event`.`owner_id`))
   OR (`owner_kind` = 'organization' AND NOT EXISTS (SELECT 1 FROM `organization` WHERE `id` = `agent_audit_event`.`owner_id`));--> statement-breakpoint

CREATE TRIGGER `agent_audit_event_owner_insert_guard`
BEFORE INSERT ON `agent_audit_event`
WHEN CASE WHEN (
  (NEW.`owner_kind` = 'realm' AND NEW.`owner_id` = 'realm' AND NEW.`quarantine_reason` IS NULL)
  OR (NEW.`owner_kind` = 'account' AND NEW.`quarantine_reason` IS NULL AND EXISTS (SELECT 1 FROM `user` WHERE `id` = NEW.`owner_id`))
  OR (NEW.`owner_kind` = 'organization' AND NEW.`quarantine_reason` IS NULL AND EXISTS (SELECT 1 FROM `organization` WHERE `id` = NEW.`owner_id`))
  OR (NEW.`owner_kind` IS NULL AND NEW.`owner_id` IS NULL AND NEW.`quarantine_reason` IS NOT NULL)
) THEN 0 ELSE 1 END
BEGIN
  SELECT RAISE(ABORT, 'agent_audit_event requires one verified owner or quarantine');
END;--> statement-breakpoint

CREATE TRIGGER `agent_audit_event_owner_update_guard`
BEFORE UPDATE OF `owner_kind`, `owner_id`, `quarantine_reason` ON `agent_audit_event`
WHEN CASE WHEN (
  (NEW.`owner_kind` = 'realm' AND NEW.`owner_id` = 'realm' AND NEW.`quarantine_reason` IS NULL)
  OR (NEW.`owner_kind` = 'account' AND NEW.`quarantine_reason` IS NULL AND EXISTS (SELECT 1 FROM `user` WHERE `id` = NEW.`owner_id`))
  OR (NEW.`owner_kind` = 'organization' AND NEW.`quarantine_reason` IS NULL AND EXISTS (SELECT 1 FROM `organization` WHERE `id` = NEW.`owner_id`))
  OR (NEW.`owner_kind` IS NULL AND NEW.`owner_id` IS NULL AND NEW.`quarantine_reason` IS NOT NULL)
) THEN 0 ELSE 1 END
BEGIN
  SELECT RAISE(ABORT, 'agent_audit_event requires one verified owner or quarantine');
END;--> statement-breakpoint

CREATE INDEX `agentAuditEvent_owner_idx` ON `agent_audit_event` (`owner_kind`,`owner_id`);--> statement-breakpoint
CREATE INDEX `agentAuditEvent_quarantineReason_idx` ON `agent_audit_event` (`quarantine_reason`);
