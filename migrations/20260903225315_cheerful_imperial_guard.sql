UPDATE `agent_enrollment_intent`
SET
	`owner_user_id` = `created_by_user_id`,
	`owner_organization_id` = NULL
WHERE `owner_user_id` IS NULL;--> statement-breakpoint
UPDATE `agent_identity`
SET
	`owner_user_id` = coalesce(
		(
			SELECT `agent`.`user_id`
			FROM `agent_identity_binding`
			INNER JOIN `agent` ON `agent`.`id` = `agent_identity_binding`.`protocol_agent_id`
			WHERE `agent_identity_binding`.`agent_identity_id` = `agent_identity`.`id`
			ORDER BY `agent_identity_binding`.`bound_at`, `agent_identity_binding`.`id`
			LIMIT 1
		),
		(
			SELECT `agent_audit_event`.`controller_user_id`
			FROM `agent_audit_event`
			WHERE `agent_audit_event`.`agent_identity_id` = `agent_identity`.`id`
				AND `agent_audit_event`.`controller_user_id` IS NOT NULL
			ORDER BY `agent_audit_event`.`occurred_at`, `agent_audit_event`.`id`
			LIMIT 1
		),
		(
			SELECT `member`.`user_id`
			FROM `member`
			WHERE `member`.`organization_id` = `agent_identity`.`owner_organization_id`
			ORDER BY `member`.`created_at`, `member`.`id`
			LIMIT 1
		)
	),
	`owner_organization_id` = NULL
WHERE `owner_user_id` IS NULL;--> statement-breakpoint
CREATE TRIGGER `agentIdentity_ownerUserRequired_insert`
BEFORE INSERT ON `agent_identity`
WHEN NEW.`owner_user_id` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'Agent identity requires a concrete User owner');
END;--> statement-breakpoint
CREATE TRIGGER `agentIdentity_ownerUserRequired_update`
BEFORE UPDATE OF `owner_user_id` ON `agent_identity`
WHEN NEW.`owner_user_id` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'Agent identity requires a concrete User owner');
END;--> statement-breakpoint
CREATE TRIGGER `agentEnrollmentIntent_ownerUserRequired_insert`
BEFORE INSERT ON `agent_enrollment_intent`
WHEN NEW.`owner_user_id` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'Agent enrollment requires a concrete User owner');
END;--> statement-breakpoint
CREATE TRIGGER `agentEnrollmentIntent_ownerUserRequired_update`
BEFORE UPDATE OF `owner_user_id` ON `agent_enrollment_intent`
WHEN NEW.`owner_user_id` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'Agent enrollment requires a concrete User owner');
END;--> statement-breakpoint
UPDATE `agent_identity` SET `owner_user_id` = `owner_user_id`;--> statement-breakpoint
UPDATE `agent_enrollment_intent` SET `owner_user_id` = `owner_user_id`;--> statement-breakpoint
UPDATE `agent_audit_event`
SET
	`owner_user_id` = (
		SELECT `agent_identity`.`owner_user_id`
		FROM `agent_identity`
		WHERE `agent_identity`.`id` = `agent_audit_event`.`agent_identity_id`
	),
	`owner_organization_id` = NULL,
	`realm_owned` = 0
WHERE `agent_identity_id` IS NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `agentIdentity_ownerOrganizationId_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `agentEnrollmentIntent_ownerOrganizationId_idx`;
