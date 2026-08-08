ALTER TABLE `resource_account_connection` RENAME TO `provider_resource_authorization`;--> statement-breakpoint
CREATE TABLE `provider_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`owner_user_id` text,
	`owner_organization_id` text,
	`authentication_account_id` text,
	`external_subject` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`connector_id`) REFERENCES `identity_provider_connector`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`authentication_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "providerConnection_exactly_one_owner_check" CHECK((("provider_connection"."owner_user_id" IS NOT NULL) + ("provider_connection"."owner_organization_id" IS NOT NULL)) = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `providerConnection_connector_user_unique` ON `provider_connection` (`connector_id`,`owner_user_id`) WHERE "provider_connection"."owner_user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `providerConnection_connector_org_unique` ON `provider_connection` (`connector_id`,`owner_organization_id`) WHERE "provider_connection"."owner_organization_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `providerConnection_authenticationAccountId_unique` ON `provider_connection` (`authentication_account_id`);--> statement-breakpoint
CREATE INDEX `providerConnection_connectorId_idx` ON `provider_connection` (`connector_id`);--> statement-breakpoint
CREATE INDEX `providerConnection_ownerUserId_idx` ON `provider_connection` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `providerConnection_ownerOrganizationId_idx` ON `provider_connection` (`owner_organization_id`);--> statement-breakpoint
CREATE INDEX `providerConnection_status_idx` ON `provider_connection` (`status`);--> statement-breakpoint
UPDATE `agent_audit_event`
SET `resource_connection_id` = NULL
WHERE `resource_connection_id` IN (
	SELECT c.`id`
	FROM `provider_resource_authorization` c
	JOIN `api_resource` r ON r.`id` = c.`resource_id`
	WHERE r.`connector_id` IS NULL
);--> statement-breakpoint
DELETE FROM `external_token_lease`
WHERE `grant_id` IN (
	SELECT g.`id`
	FROM `agent_access_grant` g
	JOIN `provider_resource_authorization` c ON c.`id` = g.`connection_id`
	JOIN `api_resource` r ON r.`id` = c.`resource_id`
	WHERE r.`connector_id` IS NULL
);--> statement-breakpoint
DELETE FROM `agent_access_request`
WHERE `connection_id` IN (
	SELECT c.`id`
	FROM `provider_resource_authorization` c
	JOIN `api_resource` r ON r.`id` = c.`resource_id`
	WHERE r.`connector_id` IS NULL
);--> statement-breakpoint
DELETE FROM `agent_access_grant`
WHERE `connection_id` IN (
	SELECT c.`id`
	FROM `provider_resource_authorization` c
	JOIN `api_resource` r ON r.`id` = c.`resource_id`
	WHERE r.`connector_id` IS NULL
);--> statement-breakpoint
DELETE FROM `provider_resource_authorization`
WHERE `resource_id` IN (SELECT `id` FROM `api_resource` WHERE `connector_id` IS NULL);--> statement-breakpoint
INSERT OR IGNORE INTO `provider_connection` (
	`id`, `connector_id`, `owner_user_id`, `owner_organization_id`, `authentication_account_id`,
	`external_subject`, `display_name`, `status`, `created_at`, `updated_at`
)
SELECT
	'provconn_auth_' || a.`id`, c.`id`, a.`user_id`, NULL, a.`id`,
	a.`account_id`, a.`account_id`, 'active', a.`created_at`, a.`updated_at`
FROM `account` a
JOIN `identity_provider_connector` c ON c.`provider_id` = a.`provider_id`
WHERE a.`provider_id` <> 'credential';--> statement-breakpoint
INSERT OR IGNORE INTO `provider_connection` (
	`id`, `connector_id`, `owner_user_id`, `owner_organization_id`, `authentication_account_id`,
	`external_subject`, `display_name`, `status`, `created_at`, `updated_at`
)
SELECT
	'provconn_' || c.`id`, r.`connector_id`, c.`owner_user_id`, c.`owner_organization_id`, NULL,
	c.`external_subject`, c.`display_name`,
	CASE WHEN c.`status` = 'active' THEN 'active' ELSE 'revoked' END,
	c.`created_at`, c.`updated_at`
FROM `provider_resource_authorization` c
JOIN `api_resource` r ON r.`id` = c.`resource_id`
WHERE r.`connector_id` IS NOT NULL
ORDER BY c.`created_at`;--> statement-breakpoint
UPDATE `provider_connection`
SET `authentication_account_id` = (
	SELECT a.`id`
	FROM `account` a
	JOIN `identity_provider_connector` c ON c.`provider_id` = a.`provider_id`
		WHERE c.`id` = `provider_connection`.`connector_id`
			AND a.`user_id` = `provider_connection`.`owner_user_id`
			AND a.`account_id` = `provider_connection`.`external_subject`
		LIMIT 1
)
WHERE `owner_user_id` IS NOT NULL
	AND `authentication_account_id` IS NULL;--> statement-breakpoint
UPDATE `agent_audit_event`
SET `resource_connection_id` = NULL
WHERE `resource_connection_id` IN (
	SELECT c.`id`
	FROM `provider_resource_authorization` c
	JOIN `api_resource` r ON r.`id` = c.`resource_id`
	JOIN `provider_connection` p ON p.`connector_id` = r.`connector_id`
		AND p.`owner_user_id` IS c.`owner_user_id`
		AND p.`owner_organization_id` IS c.`owner_organization_id`
	WHERE c.`external_subject` <> p.`external_subject`
);--> statement-breakpoint
DELETE FROM `external_token_lease`
WHERE `grant_id` IN (
	SELECT g.`id`
	FROM `agent_access_grant` g
	JOIN `provider_resource_authorization` c ON c.`id` = g.`connection_id`
	JOIN `api_resource` r ON r.`id` = c.`resource_id`
	JOIN `provider_connection` p ON p.`connector_id` = r.`connector_id`
		AND p.`owner_user_id` IS c.`owner_user_id`
		AND p.`owner_organization_id` IS c.`owner_organization_id`
	WHERE c.`external_subject` <> p.`external_subject`
);--> statement-breakpoint
DELETE FROM `agent_access_request`
WHERE `connection_id` IN (
	SELECT c.`id`
	FROM `provider_resource_authorization` c
	JOIN `api_resource` r ON r.`id` = c.`resource_id`
	JOIN `provider_connection` p ON p.`connector_id` = r.`connector_id`
		AND p.`owner_user_id` IS c.`owner_user_id`
		AND p.`owner_organization_id` IS c.`owner_organization_id`
	WHERE c.`external_subject` <> p.`external_subject`
);--> statement-breakpoint
DELETE FROM `agent_access_grant`
WHERE `connection_id` IN (
	SELECT c.`id`
	FROM `provider_resource_authorization` c
	JOIN `api_resource` r ON r.`id` = c.`resource_id`
	JOIN `provider_connection` p ON p.`connector_id` = r.`connector_id`
		AND p.`owner_user_id` IS c.`owner_user_id`
		AND p.`owner_organization_id` IS c.`owner_organization_id`
	WHERE c.`external_subject` <> p.`external_subject`
);--> statement-breakpoint
DELETE FROM `provider_resource_authorization`
WHERE `id` IN (
	SELECT c.`id`
	FROM `provider_resource_authorization` c
	JOIN `api_resource` r ON r.`id` = c.`resource_id`
	JOIN `provider_connection` p ON p.`connector_id` = r.`connector_id`
		AND p.`owner_user_id` IS c.`owner_user_id`
		AND p.`owner_organization_id` IS c.`owner_organization_id`
	WHERE c.`external_subject` <> p.`external_subject`
);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_provider_resource_authorization` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_connection_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`credential_custody` text DEFAULT 'realmroot' NOT NULL,
	`encrypted_tokens` text,
	`broker_reference` text,
	`granted_scopes` text NOT NULL,
	`authorization_details` text DEFAULT '[]' NOT NULL,
	`client_generation` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`credential_expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`provider_connection_id`) REFERENCES `provider_connection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "providerResourceAuthorization_credential_custody_check" CHECK((
        ("__new_provider_resource_authorization"."credential_custody" = 'realmroot' AND "__new_provider_resource_authorization"."encrypted_tokens" IS NOT NULL AND "__new_provider_resource_authorization"."broker_reference" IS NULL)
        OR
        ("__new_provider_resource_authorization"."credential_custody" = 'resource_server' AND "__new_provider_resource_authorization"."encrypted_tokens" IS NULL AND "__new_provider_resource_authorization"."broker_reference" IS NOT NULL)
      ))
);
--> statement-breakpoint
INSERT INTO `__new_provider_resource_authorization`("id", "provider_connection_id", "resource_id", "credential_custody", "encrypted_tokens", "broker_reference", "granted_scopes", "authorization_details", "client_generation", "status", "credential_expires_at", "revoked_at", "created_at", "updated_at")
SELECT
	c."id",
	(
		SELECT p."id"
		FROM "provider_connection" p
		JOIN "api_resource" r ON r."connector_id" = p."connector_id"
		WHERE r."id" = c."resource_id"
			AND p."owner_user_id" IS c."owner_user_id"
			AND p."owner_organization_id" IS c."owner_organization_id"
		LIMIT 1
	),
	c."resource_id", c."credential_custody", c."encrypted_tokens", c."broker_reference",
	c."granted_scopes", c."authorization_details", c."client_generation", c."status",
	c."credential_expires_at", c."revoked_at", c."created_at", c."updated_at"
FROM `provider_resource_authorization` c;--> statement-breakpoint
DROP TABLE `provider_resource_authorization`;--> statement-breakpoint
ALTER TABLE `__new_provider_resource_authorization` RENAME TO `provider_resource_authorization`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `providerResourceAuthorization_connection_resource_unique` ON `provider_resource_authorization` (`provider_connection_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `providerResourceAuthorization_providerConnectionId_idx` ON `provider_resource_authorization` (`provider_connection_id`);--> statement-breakpoint
CREATE INDEX `providerResourceAuthorization_resourceId_idx` ON `provider_resource_authorization` (`resource_id`);--> statement-breakpoint
CREATE INDEX `providerResourceAuthorization_status_idx` ON `provider_resource_authorization` (`status`);--> statement-breakpoint
CREATE TABLE `__new_agent_access_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`connection_id` text,
	`agent_identity_id` text NOT NULL,
	`scopes` text NOT NULL,
	`authorization_details` text DEFAULT '[]' NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`granted_by_user_id` text NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`connection_id`) REFERENCES `provider_resource_authorization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`granted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_agent_access_grant`("id", "resource_id", "connection_id", "agent_identity_id", "scopes", "authorization_details", "mode", "status", "granted_by_user_id", "expires_at", "revoked_at", "created_at", "updated_at") SELECT "id", "resource_id", "connection_id", "agent_identity_id", "scopes", "authorization_details", "mode", "status", "granted_by_user_id", "expires_at", "revoked_at", "created_at", "updated_at" FROM `agent_access_grant`;--> statement-breakpoint
DROP TABLE `agent_access_grant`;--> statement-breakpoint
ALTER TABLE `__new_agent_access_grant` RENAME TO `agent_access_grant`;--> statement-breakpoint
CREATE INDEX `agentAccessGrant_resourceId_idx` ON `agent_access_grant` (`resource_id`);--> statement-breakpoint
CREATE INDEX `agentAccessGrant_connectionId_idx` ON `agent_access_grant` (`connection_id`);--> statement-breakpoint
CREATE INDEX `agentAccessGrant_agentIdentityId_idx` ON `agent_access_grant` (`agent_identity_id`);--> statement-breakpoint
CREATE INDEX `agentAccessGrant_status_idx` ON `agent_access_grant` (`status`);--> statement-breakpoint
CREATE TABLE `__new_agent_access_request` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`connection_id` text,
	`agent_identity_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`scopes` text NOT NULL,
	`authorization_details` text DEFAULT '[]' NOT NULL,
	`reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`approval_token_hash` text NOT NULL,
	`encrypted_approval_token` text NOT NULL,
	`grant_id` text,
	`expires_at` integer NOT NULL,
	`decided_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`connection_id`) REFERENCES `provider_resource_authorization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`binding_id`) REFERENCES `agent_identity_binding`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_agent_access_request`("id", "resource_id", "connection_id", "agent_identity_id", "binding_id", "scopes", "authorization_details", "reason", "status", "approval_token_hash", "encrypted_approval_token", "grant_id", "expires_at", "decided_at", "created_at", "updated_at") SELECT "id", "resource_id", "connection_id", "agent_identity_id", "binding_id", "scopes", "authorization_details", "reason", "status", "approval_token_hash", "encrypted_approval_token", "grant_id", "expires_at", "decided_at", "created_at", "updated_at" FROM `agent_access_request`;--> statement-breakpoint
DROP TABLE `agent_access_request`;--> statement-breakpoint
ALTER TABLE `__new_agent_access_request` RENAME TO `agent_access_request`;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_access_request_approval_token_hash_unique` ON `agent_access_request` (`approval_token_hash`);--> statement-breakpoint
CREATE INDEX `agentAccessRequest_resourceId_idx` ON `agent_access_request` (`resource_id`);--> statement-breakpoint
CREATE INDEX `agentAccessRequest_connectionId_idx` ON `agent_access_request` (`connection_id`);--> statement-breakpoint
CREATE INDEX `agentAccessRequest_agentIdentityId_idx` ON `agent_access_request` (`agent_identity_id`);--> statement-breakpoint
CREATE INDEX `agentAccessRequest_status_idx` ON `agent_access_request` (`status`);--> statement-breakpoint
CREATE INDEX `agentAccessRequest_expiresAt_idx` ON `agent_access_request` (`expires_at`);
--> statement-breakpoint
CREATE TRIGGER `account_provider_connection_subject_guard`
BEFORE INSERT ON `account`
WHEN NEW.`provider_id` <> 'credential'
	AND EXISTS (
		SELECT 1
		FROM `provider_connection` p
		JOIN `identity_provider_connector` c ON c.`id` = p.`connector_id`
		WHERE c.`provider_id` = NEW.`provider_id`
			AND p.`owner_user_id` = NEW.`user_id`
			AND p.`status` = 'active'
			AND p.`external_subject` <> NEW.`account_id`
	)
BEGIN
	SELECT RAISE(ABORT, 'provider connection external subject mismatch');
END;--> statement-breakpoint
CREATE TRIGGER `account_provider_connection_insert`
AFTER INSERT ON `account`
WHEN NEW.`provider_id` <> 'credential'
BEGIN
	INSERT OR IGNORE INTO `provider_connection` (
		`id`, `connector_id`, `owner_user_id`, `owner_organization_id`, `authentication_account_id`,
		`external_subject`, `display_name`, `status`, `created_at`, `updated_at`
	)
	SELECT
		'provconn_auth_' || NEW.`id`, c.`id`, NEW.`user_id`, NULL, NEW.`id`,
		NEW.`account_id`, NEW.`account_id`, 'active', NEW.`created_at`, NEW.`updated_at`
	FROM `identity_provider_connector` c
	WHERE c.`provider_id` = NEW.`provider_id`;
	UPDATE `provider_connection`
	SET `authentication_account_id` = NEW.`id`,
		`external_subject` = NEW.`account_id`,
		`display_name` = NEW.`account_id`,
		`status` = 'active',
		`updated_at` = NEW.`updated_at`
	WHERE `connector_id` = (
		SELECT `id` FROM `identity_provider_connector` WHERE `provider_id` = NEW.`provider_id`
	)
		AND `owner_user_id` = NEW.`user_id`;
END;--> statement-breakpoint
CREATE TRIGGER `account_provider_connection_delete`
AFTER DELETE ON `account`
WHEN OLD.`provider_id` <> 'credential'
BEGIN
	UPDATE `provider_connection`
	SET `authentication_account_id` = NULL,
		`updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
	WHERE `authentication_account_id` = OLD.`id`;
	DELETE FROM `provider_connection`
	WHERE `authentication_account_id` IS NULL
		AND NOT EXISTS (
			SELECT 1
			FROM `provider_resource_authorization` a
			WHERE a.`provider_connection_id` = `provider_connection`.`id`
		);
END;
