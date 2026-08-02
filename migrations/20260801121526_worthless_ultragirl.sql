DROP TABLE `agent_role_assignment`;--> statement-breakpoint
DROP TABLE `application_role_assignment`;--> statement-breakpoint
DROP TABLE `member_role_assignment`;--> statement-breakpoint
DROP TABLE `role_scope`;--> statement-breakpoint
DROP TABLE `user_role_assignment`;--> statement-breakpoint
UPDATE `role`
SET `resource_id` = NULL, `organization_id` = NULL, `application_id` = NULL
WHERE `resource_id` IS NOT NULL OR `organization_id` IS NOT NULL OR `application_id` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `role_realm_global_insert`
BEFORE INSERT ON `role`
FOR EACH ROW
WHEN NEW.`resource_id` IS NOT NULL OR NEW.`organization_id` IS NOT NULL OR NEW.`application_id` IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'role definitions are Realm-global');
END;
--> statement-breakpoint
CREATE TRIGGER `role_realm_global_update`
BEFORE UPDATE OF `resource_id`, `organization_id`, `application_id` ON `role`
FOR EACH ROW
WHEN NEW.`resource_id` IS NOT NULL OR NEW.`organization_id` IS NOT NULL OR NEW.`application_id` IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'role definitions are Realm-global');
END;
