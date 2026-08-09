PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `resource_scope_entitlement` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`application_id` text,
	`agent_identity_id` text,
	`organization_id` text,
	`resource_server_id` text NOT NULL,
	`connection_id` text,
	`authorization_details` text DEFAULT '[]' NOT NULL,
	`authorization_context_hash` text NOT NULL,
	`scope` text NOT NULL,
	`mode` text NOT NULL,
	`granted_by_user_id` text NOT NULL,
	`source_access_request_id` text,
	`expires_at` integer,
	`ended_at` integer,
	`end_reason` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_server_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`connection_id`) REFERENCES `provider_resource_authorization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`granted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_access_request_id`) REFERENCES `agent_access_request`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "resourceScopeEntitlement_exactlyOneSubject_check" CHECK(((user_id is not null) + (application_id is not null) + (agent_identity_id is not null)) = 1),
	CONSTRAINT "resourceScopeEntitlement_userOrganization_check" CHECK(organization_id is null or user_id is not null),
	CONSTRAINT "resourceScopeEntitlement_agentContext_check" CHECK((connection_id is null and source_access_request_id is null) or agent_identity_id is not null),
	CONSTRAINT "resourceScopeEntitlement_lifetime_check" CHECK((mode = 'until' and expires_at is not null) or (mode in ('persistent', 'once') and expires_at is null)),
	CONSTRAINT "resourceScopeEntitlement_end_check" CHECK((ended_at is null and end_reason is null) or (ended_at is not null and end_reason is not null))
);--> statement-breakpoint

CREATE TABLE `__entitlement_candidate` AS
WITH candidate_base AS (
	SELECT
		'ent_' || lower(hex(randomblob(16))) AS id,
		g.id AS legacy_grant_id,
		g.user_id,
		NULL AS application_id,
		NULL AS agent_identity_id,
		g.organization_id,
		g.resource_server_id,
		NULL AS connection_id,
		'[]' AS authorization_details,
		'4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' AS authorization_context_hash,
		s.value AS scope,
		CASE WHEN g.expires_at IS NULL THEN 'persistent' ELSE 'until' END AS mode,
		g.granted_by_user_id,
		NULL AS source_access_request_id,
		g.expires_at,
		CASE
			WHEN g.revoked_at IS NOT NULL THEN g.revoked_at
			WHEN g.expires_at IS NOT NULL AND g.expires_at <= cast(unixepoch('subsecond') * 1000 as integer) THEN g.expires_at
		END AS source_ended_at,
		CASE
			WHEN g.revoked_at IS NOT NULL THEN 'revoked'
			WHEN g.expires_at IS NOT NULL AND g.expires_at <= cast(unixepoch('subsecond') * 1000 as integer) THEN 'expired'
		END AS source_end_reason,
		g.created_at,
		g.created_at AS updated_at,
		2 AS subject_kind
	FROM user_scope_grant g, json_each(g.scopes) s
	UNION ALL
	SELECT
		'ent_' || lower(hex(randomblob(16))),
		g.id,
		NULL,
		g.application_id,
		NULL,
		NULL,
		g.resource_server_id,
		NULL,
		'[]',
		'4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
		s.value,
		CASE WHEN g.expires_at IS NULL THEN 'persistent' ELSE 'until' END,
		g.granted_by_user_id,
		NULL,
		g.expires_at,
		CASE
			WHEN g.revoked_at IS NOT NULL THEN g.revoked_at
			WHEN g.expires_at IS NOT NULL AND g.expires_at <= cast(unixepoch('subsecond') * 1000 as integer) THEN g.expires_at
		END,
		CASE
			WHEN g.revoked_at IS NOT NULL THEN 'revoked'
			WHEN g.expires_at IS NOT NULL AND g.expires_at <= cast(unixepoch('subsecond') * 1000 as integer) THEN 'expired'
		END,
		g.created_at,
		g.created_at,
		1
	FROM application_scope_grant g, json_each(g.scopes) s
	UNION ALL
	SELECT
		'ent_' || lower(hex(randomblob(16))),
		g.id,
		NULL,
		NULL,
		g.agent_identity_id,
		NULL,
		g.resource_id,
		g.connection_id,
		json(g.authorization_details),
		'legacy:' || lower(hex(json(g.authorization_details))),
		s.value,
		g.mode,
		g.granted_by_user_id,
		(SELECT r.id FROM agent_access_request r WHERE r.grant_id = g.id ORDER BY r.created_at LIMIT 1),
		g.expires_at,
		CASE
			WHEN g.revoked_at IS NOT NULL OR g.status = 'revoked' THEN coalesce(g.revoked_at, g.updated_at)
			WHEN g.status = 'consumed' THEN g.updated_at
			WHEN g.expires_at IS NOT NULL AND g.expires_at <= cast(unixepoch('subsecond') * 1000 as integer) THEN g.expires_at
		END,
		CASE
			WHEN g.revoked_at IS NOT NULL OR g.status = 'revoked' THEN 'revoked'
			WHEN g.status = 'consumed' THEN 'consumed'
			WHEN g.expires_at IS NOT NULL AND g.expires_at <= cast(unixepoch('subsecond') * 1000 as integer) THEN 'expired'
		END,
		g.created_at,
		g.updated_at,
		3
	FROM agent_access_grant g, json_each(g.scopes) s
), ranked AS (
	SELECT *, row_number() OVER (
		PARTITION BY subject_kind, coalesce(user_id, ''), coalesce(application_id, ''), coalesce(agent_identity_id, ''),
			coalesce(organization_id, ''), resource_server_id, coalesce(connection_id, ''), authorization_details, scope
		ORDER BY (source_ended_at IS NULL) DESC,
			CASE mode WHEN 'persistent' THEN 3 WHEN 'until' THEN 2 ELSE 1 END DESC,
			expires_at DESC, updated_at DESC, id
	) AS entitlement_rank
	FROM candidate_base
)
SELECT *, first_value(id) OVER (
	PARTITION BY subject_kind, coalesce(user_id, ''), coalesce(application_id, ''), coalesce(agent_identity_id, ''),
		coalesce(organization_id, ''), resource_server_id, coalesce(connection_id, ''), authorization_details, scope
	ORDER BY entitlement_rank
) AS canonical_id
FROM ranked;--> statement-breakpoint

INSERT INTO resource_scope_entitlement (
	id, user_id, application_id, agent_identity_id, organization_id, resource_server_id, connection_id,
	authorization_details, authorization_context_hash, scope, mode, granted_by_user_id, source_access_request_id,
	expires_at, ended_at, end_reason, created_at, updated_at
)
SELECT
	id, user_id, application_id, agent_identity_id, organization_id, resource_server_id, connection_id,
	authorization_details, authorization_context_hash, scope, mode, granted_by_user_id, source_access_request_id,
	expires_at,
	CASE WHEN source_ended_at IS NOT NULL THEN source_ended_at WHEN entitlement_rank > 1 THEN updated_at END,
	CASE WHEN source_end_reason IS NOT NULL THEN source_end_reason WHEN entitlement_rank > 1 THEN 'merged' END,
	created_at, updated_at
FROM __entitlement_candidate;--> statement-breakpoint

CREATE INDEX `resourceScopeEntitlement_userId_idx` ON `resource_scope_entitlement` (`user_id`);--> statement-breakpoint
CREATE INDEX `resourceScopeEntitlement_applicationId_idx` ON `resource_scope_entitlement` (`application_id`);--> statement-breakpoint
CREATE INDEX `resourceScopeEntitlement_agentIdentityId_idx` ON `resource_scope_entitlement` (`agent_identity_id`);--> statement-breakpoint
CREATE INDEX `resourceScopeEntitlement_resourceServerId_idx` ON `resource_scope_entitlement` (`resource_server_id`);--> statement-breakpoint
CREATE INDEX `resourceScopeEntitlement_connectionId_idx` ON `resource_scope_entitlement` (`connection_id`);--> statement-breakpoint
CREATE INDEX `resourceScopeEntitlement_sourceAccessRequestId_idx` ON `resource_scope_entitlement` (`source_access_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `resourceScopeEntitlement_activeUser_unique` ON `resource_scope_entitlement` (`user_id`, ifnull(`organization_id`, ''), `resource_server_id`, `authorization_context_hash`, `scope`) WHERE `user_id` is not null and `ended_at` is null;--> statement-breakpoint
CREATE UNIQUE INDEX `resourceScopeEntitlement_activeApplication_unique` ON `resource_scope_entitlement` (`application_id`, `resource_server_id`, `authorization_context_hash`, `scope`) WHERE `application_id` is not null and `ended_at` is null;--> statement-breakpoint
CREATE UNIQUE INDEX `resourceScopeEntitlement_activeAgent_unique` ON `resource_scope_entitlement` (`agent_identity_id`, `resource_server_id`, ifnull(`connection_id`, ''), `authorization_context_hash`, `scope`) WHERE `agent_identity_id` is not null and `ended_at` is null;--> statement-breakpoint

CREATE TABLE `__new_external_token_lease` (
	`id` text PRIMARY KEY NOT NULL,
	`entitlement_ids` text NOT NULL,
	`request_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`encrypted_access_token` text NOT NULL,
	`token_hash` text NOT NULL,
	`confirmation_jkt` text NOT NULL,
	`scopes` text NOT NULL,
	`authorization_details` text DEFAULT '[]' NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `agent_access_request`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`binding_id`) REFERENCES `agent_identity_binding`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
INSERT INTO `__new_external_token_lease`
SELECT
	l.id,
	coalesce((SELECT json_group_array(canonical_id) FROM (SELECT DISTINCT canonical_id FROM __entitlement_candidate c WHERE c.legacy_grant_id = l.grant_id ORDER BY scope)), '[]'),
	l.request_id, l.binding_id, l.encrypted_access_token, l.token_hash, l.confirmation_jkt, l.scopes,
	l.authorization_details, l.expires_at, l.revoked_at, l.created_at
FROM external_token_lease l;--> statement-breakpoint
DROP TABLE `external_token_lease`;--> statement-breakpoint
ALTER TABLE `__new_external_token_lease` RENAME TO `external_token_lease`;--> statement-breakpoint
CREATE UNIQUE INDEX `external_token_lease_token_hash_unique` ON `external_token_lease` (`token_hash`);--> statement-breakpoint
CREATE INDEX `externalTokenLease_requestId_idx` ON `external_token_lease` (`request_id`);--> statement-breakpoint
CREATE INDEX `externalTokenLease_bindingId_idx` ON `external_token_lease` (`binding_id`);--> statement-breakpoint
CREATE INDEX `externalTokenLease_expiresAt_idx` ON `external_token_lease` (`expires_at`);--> statement-breakpoint

ALTER TABLE `agent_access_request` ADD `approved_entitlements` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE agent_access_request
SET approved_entitlements = coalesce((
	SELECT json_group_array(json_object('scope', scope, 'entitlementId', canonical_id))
	FROM (SELECT DISTINCT scope, canonical_id FROM __entitlement_candidate c WHERE c.legacy_grant_id = agent_access_request.grant_id ORDER BY scope)
), '[]')
WHERE grant_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_access_request` DROP COLUMN `grant_id`;--> statement-breakpoint

ALTER TABLE `agent_audit_event` ADD `access_request_id` text;--> statement-breakpoint
UPDATE agent_audit_event
SET access_request_id = (
	SELECT source_access_request_id FROM __entitlement_candidate c
	WHERE c.legacy_grant_id = agent_audit_event.access_grant_id AND c.source_access_request_id IS NOT NULL
	LIMIT 1
)
WHERE access_grant_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_audit_event` DROP COLUMN `access_grant_id`;--> statement-breakpoint

CREATE TABLE `__entitlement_migration_verifier` (
	`violations` integer NOT NULL CHECK (`violations` = 0)
);--> statement-breakpoint
INSERT INTO `__entitlement_migration_verifier`
SELECT count(*) FROM __entitlement_candidate c
WHERE c.source_ended_at IS NULL AND NOT EXISTS (
	SELECT 1 FROM resource_scope_entitlement e WHERE e.id = c.canonical_id AND e.ended_at IS NULL
);--> statement-breakpoint
DROP TABLE `__entitlement_migration_verifier`;--> statement-breakpoint

DROP TABLE `application_scope_grant`;--> statement-breakpoint
DROP TABLE `user_scope_grant`;--> statement-breakpoint
DROP TABLE `agent_access_grant`;--> statement-breakpoint
DROP TABLE `__entitlement_candidate`;
