PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_resource_scope_entitlement` (
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
	`granted_by_user_id` text,
	`granted_by_agent_identity_id` text,
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
	FOREIGN KEY (`granted_by_agent_identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_access_request_id`) REFERENCES `agent_access_request`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "resourceScopeEntitlement_exactlyOneSubject_check" CHECK((("__new_resource_scope_entitlement"."user_id" is not null) + ("__new_resource_scope_entitlement"."application_id" is not null) + ("__new_resource_scope_entitlement"."agent_identity_id" is not null)) = 1),
	CONSTRAINT "resourceScopeEntitlement_userOrganization_check" CHECK("__new_resource_scope_entitlement"."organization_id" is null or "__new_resource_scope_entitlement"."user_id" is not null),
	CONSTRAINT "resourceScopeEntitlement_agentContext_check" CHECK(("__new_resource_scope_entitlement"."connection_id" is null and "__new_resource_scope_entitlement"."source_access_request_id" is null) or "__new_resource_scope_entitlement"."agent_identity_id" is not null),
	CONSTRAINT "resourceScopeEntitlement_lifetime_check" CHECK(("__new_resource_scope_entitlement"."mode" = 'until' and "__new_resource_scope_entitlement"."expires_at" is not null) or ("__new_resource_scope_entitlement"."mode" in ('persistent', 'once') and "__new_resource_scope_entitlement"."expires_at" is null)),
	CONSTRAINT "resourceScopeEntitlement_end_check" CHECK(("__new_resource_scope_entitlement"."ended_at" is null and "__new_resource_scope_entitlement"."end_reason" is null) or ("__new_resource_scope_entitlement"."ended_at" is not null and "__new_resource_scope_entitlement"."end_reason" is not null)),
	CONSTRAINT "resourceScopeEntitlement_exactlyOneGrantor_check" CHECK((("__new_resource_scope_entitlement"."granted_by_user_id" is not null) + ("__new_resource_scope_entitlement"."granted_by_agent_identity_id" is not null)) = 1)
);
--> statement-breakpoint
INSERT INTO `__new_resource_scope_entitlement`("id", "user_id", "application_id", "agent_identity_id", "organization_id", "resource_server_id", "connection_id", "authorization_details", "authorization_context_hash", "scope", "mode", "granted_by_user_id", "granted_by_agent_identity_id", "source_access_request_id", "expires_at", "ended_at", "end_reason", "created_at", "updated_at") SELECT "id", "user_id", "application_id", "agent_identity_id", "organization_id", "resource_server_id", "connection_id", "authorization_details", "authorization_context_hash", "scope", "mode", "granted_by_user_id", NULL, "source_access_request_id", "expires_at", "ended_at", "end_reason", "created_at", "updated_at" FROM `resource_scope_entitlement`;--> statement-breakpoint
DROP TABLE `resource_scope_entitlement`;--> statement-breakpoint
ALTER TABLE `__new_resource_scope_entitlement` RENAME TO `resource_scope_entitlement`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `resourceScopeEntitlement_userId_idx` ON `resource_scope_entitlement` (`user_id`);--> statement-breakpoint
CREATE INDEX `resourceScopeEntitlement_applicationId_idx` ON `resource_scope_entitlement` (`application_id`);--> statement-breakpoint
CREATE INDEX `resourceScopeEntitlement_agentIdentityId_idx` ON `resource_scope_entitlement` (`agent_identity_id`);--> statement-breakpoint
CREATE INDEX `resourceScopeEntitlement_resourceServerId_idx` ON `resource_scope_entitlement` (`resource_server_id`);--> statement-breakpoint
CREATE INDEX `resourceScopeEntitlement_connectionId_idx` ON `resource_scope_entitlement` (`connection_id`);--> statement-breakpoint
CREATE INDEX `resourceScopeEntitlement_sourceAccessRequestId_idx` ON `resource_scope_entitlement` (`source_access_request_id`);--> statement-breakpoint
CREATE INDEX `resourceScopeEntitlement_grantedByAgentIdentityId_idx` ON `resource_scope_entitlement` (`granted_by_agent_identity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `resourceScopeEntitlement_activeUser_unique` ON `resource_scope_entitlement` (`user_id`, ifnull(`organization_id`, ''), `resource_server_id`, `authorization_context_hash`, `scope`) WHERE `user_id` is not null and `ended_at` is null;--> statement-breakpoint
CREATE UNIQUE INDEX `resourceScopeEntitlement_activeApplication_unique` ON `resource_scope_entitlement` (`application_id`,`resource_server_id`,`authorization_context_hash`,`scope`) WHERE "resource_scope_entitlement"."application_id" is not null and "resource_scope_entitlement"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `resourceScopeEntitlement_activeAgent_unique` ON `resource_scope_entitlement` (`agent_identity_id`, `resource_server_id`, ifnull(`connection_id`, ''), `authorization_context_hash`, `scope`) WHERE `agent_identity_id` is not null and `ended_at` is null;
