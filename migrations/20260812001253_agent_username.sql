ALTER TABLE `agent_identity` ADD `username` text;--> statement-breakpoint
ALTER TABLE `agent_identity` ADD `runtime` text;--> statement-breakpoint
ALTER TABLE `agent_enrollment_intent` ADD `requested_username` text;--> statement-breakpoint
ALTER TABLE `agent_enrollment_intent` ADD `requested_runtime` text;--> statement-breakpoint
CREATE UNIQUE INDEX `agentIdentity_username_unique` ON `agent_identity` (`username`) WHERE `username` is not null;--> statement-breakpoint
CREATE TRIGGER `agentIdentity_username_insert_check`
BEFORE INSERT ON `agent_identity`
WHEN NEW.`username` IS NULL
  OR length(NEW.`username`) NOT BETWEEN 3 AND 64
  OR NEW.`username` GLOB '*[^a-z0-9_.-]*'
BEGIN
  SELECT RAISE(ABORT, 'Agent username is invalid');
END;--> statement-breakpoint
CREATE TRIGGER `agentIdentity_username_update_check`
BEFORE UPDATE OF `username` ON `agent_identity`
WHEN NEW.`username` IS NULL
  OR length(NEW.`username`) NOT BETWEEN 3 AND 64
  OR NEW.`username` GLOB '*[^a-z0-9_.-]*'
BEGIN
  SELECT RAISE(ABORT, 'Agent username is invalid');
END;--> statement-breakpoint
CREATE TRIGGER `agentIdentity_username_immutable`
BEFORE UPDATE OF `username` ON `agent_identity`
WHEN OLD.`username` IS NOT NULL AND NEW.`username` IS NOT OLD.`username`
BEGIN
  SELECT RAISE(ABORT, 'Agent username is immutable');
END;
