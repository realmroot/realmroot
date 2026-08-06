CREATE TABLE `ownership_quarantine` (
	`source_table` text NOT NULL,
	`source_id` text NOT NULL,
	`reason_code` text NOT NULL,
	`quarantined_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "ownershipQuarantine_source_table_check" CHECK("ownership_quarantine"."source_table" in ('agent_audit_event'))
);
--> statement-breakpoint
CREATE INDEX `ownershipQuarantine_source_idx` ON `ownership_quarantine` (`source_table`,`source_id`);--> statement-breakpoint
DELETE FROM `member` WHERE `organization_id` = 'org_platform';--> statement-breakpoint
DELETE FROM `organization_role` WHERE `organization_id` = 'org_platform';--> statement-breakpoint
UPDATE `agent_identity_binding` SET `status` = 'revoked', `revoked_at` = coalesce(`revoked_at`, cast(unixepoch('subsecond') * 1000 as integer)), `updated_at` = cast(unixepoch('subsecond') * 1000 as integer) WHERE `agent_identity_id` IN (SELECT `id` FROM `agent_identity` WHERE `owner_organization_id` = 'org_platform');--> statement-breakpoint
UPDATE `agent_access_grant` SET `status` = 'revoked', `revoked_at` = coalesce(`revoked_at`, cast(unixepoch('subsecond') * 1000 as integer)), `updated_at` = cast(unixepoch('subsecond') * 1000 as integer) WHERE `agent_identity_id` IN (SELECT `id` FROM `agent_identity` WHERE `owner_organization_id` = 'org_platform');--> statement-breakpoint
UPDATE `agent_identity` SET `status` = 'retired', `retired_at` = coalesce(`retired_at`, cast(unixepoch('subsecond') * 1000 as integer)), `updated_at` = cast(unixepoch('subsecond') * 1000 as integer) WHERE `owner_organization_id` = 'org_platform';--> statement-breakpoint
CREATE TABLE `__preserve_account_center_setting` AS SELECT * FROM `account_center_setting`;--> statement-breakpoint
CREATE TABLE `__preserve_application_audience_organization` AS SELECT * FROM `application_audience_organization`;--> statement-breakpoint
CREATE TABLE `__preserve_application_audience_user` AS SELECT * FROM `application_audience_user`;--> statement-breakpoint
CREATE TABLE `__preserve_application_client_metadata` AS SELECT * FROM `application_client_metadata`;--> statement-breakpoint
CREATE TABLE `__preserve_application_client_secret` AS SELECT * FROM `application_client_secret`;--> statement-breakpoint
CREATE TABLE `__preserve_application_consent` AS SELECT * FROM `application_consent`;--> statement-breakpoint
CREATE TABLE `__preserve_branding_setting` AS SELECT * FROM `branding_setting`;--> statement-breakpoint
CREATE TABLE `__preserve_custom_domain` AS SELECT * FROM `custom_domain`;--> statement-breakpoint
CREATE TABLE `__preserve_federated_credential` AS SELECT * FROM `federated_credential`;--> statement-breakpoint
CREATE TABLE `__preserve_sign_in_application` AS SELECT `id`, `default_application_id` FROM `sign_in_experience` WHERE `default_application_id` IS NOT NULL;--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_application` (
	`id` text PRIMARY KEY NOT NULL,
	`oauth_client_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`homepage_url` text,
	`logo_asset_id` text,
	`owner_organization_id` text NOT NULL,
	`audience_mode` text DEFAULT 'realm' NOT NULL,
	`first_party` integer DEFAULT false NOT NULL,
	`trusted` integer DEFAULT false NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`disabled_reason` text,
	`access_token_ttl_seconds` integer,
	`refresh_token_ttl_seconds` integer,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`oauth_client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`logo_asset_id`) REFERENCES `uploaded_asset`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
INSERT INTO `__new_application` SELECT `id`, `oauth_client_id`, `slug`, `name`, `description`, `homepage_url`, `logo_asset_id`, `owner_organization_id`, `audience_mode`, `first_party`, `trusted`, `disabled`, `disabled_reason`, `access_token_ttl_seconds`, `refresh_token_ttl_seconds`, `metadata`, `created_at`, `updated_at` FROM `application`;--> statement-breakpoint
DROP TABLE `application`;--> statement-breakpoint
ALTER TABLE `__new_application` RENAME TO `application`;--> statement-breakpoint
CREATE UNIQUE INDEX `application_slug_unique` ON `application` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_oauthClientId_unique` ON `application` (`oauth_client_id`);--> statement-breakpoint
CREATE INDEX `application_ownerOrganizationId_idx` ON `application` (`owner_organization_id`);--> statement-breakpoint
CREATE INDEX `application_disabled_idx` ON `application` (`disabled`);--> statement-breakpoint
INSERT INTO `account_center_setting` SELECT * FROM `__preserve_account_center_setting`;--> statement-breakpoint
INSERT INTO `application_audience_organization` SELECT * FROM `__preserve_application_audience_organization`;--> statement-breakpoint
INSERT INTO `application_audience_user` SELECT * FROM `__preserve_application_audience_user`;--> statement-breakpoint
INSERT INTO `application_client_metadata` SELECT * FROM `__preserve_application_client_metadata`;--> statement-breakpoint
INSERT INTO `application_client_secret` SELECT * FROM `__preserve_application_client_secret`;--> statement-breakpoint
INSERT INTO `branding_setting` SELECT * FROM `__preserve_branding_setting`;--> statement-breakpoint
INSERT INTO `custom_domain` SELECT * FROM `__preserve_custom_domain`;--> statement-breakpoint
INSERT INTO `federated_credential` SELECT * FROM `__preserve_federated_credential`;--> statement-breakpoint
UPDATE `sign_in_experience` SET `default_application_id` = (SELECT p.`default_application_id` FROM `__preserve_sign_in_application` p WHERE p.`id` = `sign_in_experience`.`id`) WHERE `id` IN (SELECT `id` FROM `__preserve_sign_in_application`);--> statement-breakpoint
CREATE TABLE `__new_application_consent` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scopes` text NOT NULL,
	`permissions` text,
	`granted_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_application_consent`("id", "application_id", "user_id", "scopes", "permissions", "granted_at", "expires_at", "revoked_at") SELECT "id", "application_id", "user_id", "scopes", "permissions", "granted_at", "expires_at", "revoked_at" FROM `__preserve_application_consent`;--> statement-breakpoint
DROP TABLE `application_consent`;--> statement-breakpoint
ALTER TABLE `__new_application_consent` RENAME TO `application_consent`;--> statement-breakpoint
CREATE INDEX `applicationConsent_applicationId_idx` ON `application_consent` (`application_id`);--> statement-breakpoint
CREATE INDEX `applicationConsent_userId_idx` ON `application_consent` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `applicationConsent_activeApplicationUser_unique` ON `application_consent` (`application_id`,`user_id`) WHERE "application_consent"."revoked_at" is null;--> statement-breakpoint
DROP TABLE `__preserve_account_center_setting`;--> statement-breakpoint
DROP TABLE `__preserve_application_audience_organization`;--> statement-breakpoint
DROP TABLE `__preserve_application_audience_user`;--> statement-breakpoint
DROP TABLE `__preserve_application_client_metadata`;--> statement-breakpoint
DROP TABLE `__preserve_application_client_secret`;--> statement-breakpoint
DROP TABLE `__preserve_application_consent`;--> statement-breakpoint
DROP TABLE `__preserve_branding_setting`;--> statement-breakpoint
DROP TABLE `__preserve_custom_domain`;--> statement-breakpoint
DROP TABLE `__preserve_federated_credential`;--> statement-breakpoint
DROP TABLE `__preserve_sign_in_application`;--> statement-breakpoint
CREATE TABLE `__new_resource_connection_intent` (
	`id` text PRIMARY KEY NOT NULL,
	`state_hash` text NOT NULL,
	`resource_id` text NOT NULL,
	`owner_user_id` text,
	`owner_organization_id` text,
	`initiated_by_user_id` text NOT NULL,
	`scopes` text NOT NULL,
	`authorization_details` text DEFAULT '[]' NOT NULL,
	`encrypted_pkce_verifier` text NOT NULL,
	`client_generation` integer DEFAULT 1 NOT NULL,
	`return_to` text DEFAULT 'account-center' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`initiated_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "resourceConnectionIntent_exactly_one_owner_check" CHECK((("__new_resource_connection_intent"."owner_user_id" IS NOT NULL) + ("__new_resource_connection_intent"."owner_organization_id" IS NOT NULL)) = 1)
);
--> statement-breakpoint
INSERT INTO `__new_resource_connection_intent`("id", "state_hash", "resource_id", "owner_user_id", "owner_organization_id", "initiated_by_user_id", "scopes", "authorization_details", "encrypted_pkce_verifier", "client_generation", "return_to", "status", "expires_at", "completed_at", "created_at", "updated_at") SELECT "id", "state_hash", "resource_id", CASE WHEN "owner_organization_id" IS NULL THEN "owner_user_id" ELSE NULL END, "owner_organization_id", "owner_user_id", "scopes", "authorization_details", "encrypted_pkce_verifier", "client_generation", "return_to", "status", "expires_at", "completed_at", "created_at", "updated_at" FROM `resource_connection_intent`;--> statement-breakpoint
DROP TABLE `resource_connection_intent`;--> statement-breakpoint
ALTER TABLE `__new_resource_connection_intent` RENAME TO `resource_connection_intent`;--> statement-breakpoint
CREATE UNIQUE INDEX `resource_connection_intent_state_hash_unique` ON `resource_connection_intent` (`state_hash`);--> statement-breakpoint
CREATE INDEX `resourceConnectionIntent_resourceId_idx` ON `resource_connection_intent` (`resource_id`);--> statement-breakpoint
CREATE INDEX `resourceConnectionIntent_ownerUserId_idx` ON `resource_connection_intent` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `resourceConnectionIntent_ownerOrganizationId_idx` ON `resource_connection_intent` (`owner_organization_id`);--> statement-breakpoint
CREATE INDEX `resourceConnectionIntent_initiatedByUserId_idx` ON `resource_connection_intent` (`initiated_by_user_id`);--> statement-breakpoint
CREATE INDEX `resourceConnectionIntent_status_idx` ON `resource_connection_intent` (`status`);--> statement-breakpoint
CREATE INDEX `resourceConnectionIntent_expiresAt_idx` ON `resource_connection_intent` (`expires_at`);--> statement-breakpoint
CREATE TABLE `__new_agent_audit_event` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`result` text NOT NULL,
	`realm_owned` integer DEFAULT false NOT NULL,
	`owner_user_id` text,
	`owner_organization_id` text,
	`controller_user_id` text,
	`subject_issuer` text,
	`subject` text,
	`agent_identity_id` text,
	`host_id` text,
	`resource_id` text,
	`resource_connection_id` text,
	`access_grant_id` text,
	`scopes` text,
	`reason_code` text,
	`metadata` text,
	`occurred_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "agentAuditEvent_exactly_one_owner_check" CHECK((("__new_agent_audit_event"."realm_owned" = 1) + ("__new_agent_audit_event"."owner_user_id" is not null) + ("__new_agent_audit_event"."owner_organization_id" is not null)) = 1)
);
--> statement-breakpoint
CREATE TABLE `__audit_boundary` AS
WITH `candidates` AS (
	SELECT e.`id` AS `event_id`, CASE WHEN c.`owner_user_id` IS NOT NULL THEN 'user' WHEN c.`owner_organization_id` = 'org_platform' THEN 'realm' ELSE 'organization' END AS `boundary_type`, CASE WHEN c.`owner_user_id` IS NOT NULL THEN c.`owner_user_id` WHEN c.`owner_organization_id` = 'org_platform' THEN '' ELSE c.`owner_organization_id` END AS `boundary_id`
	FROM `agent_audit_event` e JOIN `resource_account_connection` c ON c.`id` = e.`resource_connection_id`
	UNION ALL
	SELECT e.`id`, CASE WHEN i.`owner_user_id` IS NOT NULL THEN 'user' WHEN i.`owner_organization_id` = 'org_platform' THEN 'realm' ELSE 'organization' END, CASE WHEN i.`owner_user_id` IS NOT NULL THEN i.`owner_user_id` WHEN i.`owner_organization_id` = 'org_platform' THEN '' ELSE i.`owner_organization_id` END
	FROM `agent_audit_event` e JOIN `agent_identity` i ON i.`id` = e.`agent_identity_id`
	UNION ALL
	SELECT e.`id`, CASE WHEN i.`owner_user_id` IS NOT NULL THEN 'user' WHEN i.`owner_organization_id` = 'org_platform' THEN 'realm' ELSE 'organization' END, CASE WHEN i.`owner_user_id` IS NOT NULL THEN i.`owner_user_id` WHEN i.`owner_organization_id` = 'org_platform' THEN '' ELSE i.`owner_organization_id` END
	FROM `agent_audit_event` e JOIN `agent_access_grant` g ON g.`id` = e.`access_grant_id` JOIN `agent_identity` i ON i.`id` = g.`agent_identity_id`
	UNION ALL
	SELECT e.`id`, CASE WHEN r.`owner_organization_id` = 'org_platform' THEN 'realm' ELSE 'organization' END, CASE WHEN r.`owner_organization_id` = 'org_platform' THEN '' ELSE r.`owner_organization_id` END
	FROM `agent_audit_event` e JOIN `api_resource` r ON r.`id` = e.`resource_id`
	UNION ALL
	SELECT e.`id`, CASE WHEN json_extract(e.`metadata`, '$.organizationId') = 'org_platform' THEN 'realm' ELSE 'organization' END, CASE WHEN json_extract(e.`metadata`, '$.organizationId') = 'org_platform' THEN '' ELSE json_extract(e.`metadata`, '$.organizationId') END
	FROM `agent_audit_event` e
	WHERE json_valid(e.`metadata`) AND json_type(e.`metadata`, '$.organizationId') = 'text'
), `distinct_candidates` AS (
	SELECT DISTINCT `event_id`, `boundary_type`, `boundary_id` FROM `candidates`
), `resolved` AS (
	SELECT e.`id` AS `event_id`, count(c.`event_id`) AS `candidate_count`, max(c.`boundary_type`) AS `boundary_type`, max(c.`boundary_id`) AS `boundary_id`
	FROM `agent_audit_event` e LEFT JOIN `distinct_candidates` c ON c.`event_id` = e.`id`
	GROUP BY e.`id`
)
SELECT
	r.`event_id`,
	CASE WHEN r.`candidate_count` = 1 AND r.`boundary_type` = 'realm' THEN 1 ELSE 0 END AS `realm_owned`,
	CASE WHEN r.`candidate_count` = 1 AND r.`boundary_type` = 'user' AND EXISTS (SELECT 1 FROM `user` u WHERE u.`id` = r.`boundary_id`) THEN r.`boundary_id` ELSE NULL END AS `owner_user_id`,
	CASE WHEN r.`candidate_count` = 1 AND r.`boundary_type` = 'organization' AND EXISTS (SELECT 1 FROM `organization` o WHERE o.`id` = r.`boundary_id`) THEN r.`boundary_id` ELSE NULL END AS `owner_organization_id`,
	CASE
		WHEN r.`candidate_count` = 0 THEN 'owner_not_determinable'
		WHEN r.`candidate_count` > 1 THEN 'owner_conflict'
		WHEN r.`boundary_type` = 'user' AND NOT EXISTS (SELECT 1 FROM `user` u WHERE u.`id` = r.`boundary_id`) THEN 'owner_reference_invalid'
		WHEN r.`boundary_type` = 'organization' AND NOT EXISTS (SELECT 1 FROM `organization` o WHERE o.`id` = r.`boundary_id`) THEN 'owner_reference_invalid'
		ELSE NULL
	END AS `reason_code`
FROM `resolved` r;--> statement-breakpoint
INSERT INTO `ownership_quarantine` (`source_table`, `source_id`, `reason_code`)
SELECT 'agent_audit_event', `event_id`, `reason_code`
FROM `__audit_boundary`
WHERE `reason_code` IS NOT NULL;--> statement-breakpoint
INSERT INTO `__new_agent_audit_event`("id", "action", "result", "realm_owned", "owner_user_id", "owner_organization_id", "controller_user_id", "subject_issuer", "subject", "agent_identity_id", "host_id", "resource_id", "resource_connection_id", "access_grant_id", "scopes", "reason_code", "metadata", "occurred_at")
SELECT e."id", e."action", e."result", b."realm_owned", CASE WHEN b."owner_organization_id" IS NULL AND b."realm_owned" = 0 THEN b."owner_user_id" ELSE NULL END, b."owner_organization_id", e."controller_user_id", e."subject_issuer", e."subject", e."agent_identity_id", e."host_id", e."resource_id", e."resource_connection_id", e."access_grant_id", e."scopes", e."reason_code", e."metadata", e."occurred_at"
FROM `agent_audit_event` e
JOIN `__audit_boundary` b ON b.`event_id` = e.`id`
WHERE b.`reason_code` IS NULL;--> statement-breakpoint
DROP TABLE `__audit_boundary`;--> statement-breakpoint
DROP TABLE `agent_audit_event`;--> statement-breakpoint
ALTER TABLE `__new_agent_audit_event` RENAME TO `agent_audit_event`;--> statement-breakpoint
CREATE INDEX `agentAuditEvent_occurredAt_idx` ON `agent_audit_event` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `agentAuditEvent_ownerUserId_idx` ON `agent_audit_event` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `agentAuditEvent_ownerOrganizationId_idx` ON `agent_audit_event` (`owner_organization_id`);--> statement-breakpoint
CREATE INDEX `agentAuditEvent_agentIdentityId_idx` ON `agent_audit_event` (`agent_identity_id`);--> statement-breakpoint
CREATE INDEX `agentAuditEvent_resourceId_idx` ON `agent_audit_event` (`resource_id`);--> statement-breakpoint
CREATE INDEX `agentAuditEvent_result_idx` ON `agent_audit_event` (`result`);
--> statement-breakpoint
CREATE TABLE `__ownership_verifier` (`violations` integer NOT NULL CHECK (`violations` = 0));--> statement-breakpoint
INSERT INTO `__ownership_verifier` SELECT count(*) FROM `member` WHERE `organization_id` = 'org_platform';--> statement-breakpoint
INSERT INTO `__ownership_verifier` SELECT count(*) FROM `organization_role` WHERE `organization_id` = 'org_platform';--> statement-breakpoint
INSERT INTO `__ownership_verifier` SELECT count(*) FROM `agent_identity` WHERE `owner_organization_id` = 'org_platform' AND `status` != 'retired';--> statement-breakpoint
INSERT INTO `__ownership_verifier` SELECT count(*) FROM `resource_connection_intent` WHERE ((`owner_user_id` IS NOT NULL) + (`owner_organization_id` IS NOT NULL)) != 1;--> statement-breakpoint
INSERT INTO `__ownership_verifier` SELECT count(*) FROM `agent_audit_event` WHERE ((`realm_owned` = 1) + (`owner_user_id` IS NOT NULL) + (`owner_organization_id` IS NOT NULL)) != 1;--> statement-breakpoint
INSERT INTO `__ownership_verifier` SELECT count(*) FROM `agent_audit_event` e WHERE e.`owner_user_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `user` u WHERE u.`id` = e.`owner_user_id`);--> statement-breakpoint
INSERT INTO `__ownership_verifier` SELECT count(*) FROM `agent_audit_event` e WHERE e.`owner_organization_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `organization` o WHERE o.`id` = e.`owner_organization_id`);--> statement-breakpoint
INSERT INTO `__ownership_verifier` SELECT count(*) FROM pragma_foreign_key_check;--> statement-breakpoint
DROP TABLE `__ownership_verifier`;
