CREATE TABLE `oauth_client_assertion` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_client_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`metadata` text,
	`created_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `oauth_resource`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauthClientResource_clientResource_unique` ON `oauth_client_resource` (`client_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `oauthClientResource_resourceId_idx` ON `oauth_client_resource` (`resource_id`);--> statement-breakpoint
CREATE TABLE `oauth_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`name` text NOT NULL,
	`access_token_ttl` integer,
	`refresh_token_ttl` integer,
	`signing_algorithm` text,
	`signing_key_id` text,
	`allowed_scopes` text,
	`custom_claims` text,
	`dpop_bound_access_tokens_required` integer DEFAULT false,
	`disabled` integer DEFAULT false,
	`created_at` integer,
	`updated_at` integer,
	`policy_version` integer DEFAULT 1,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_resource_identifier_unique` ON `oauth_resource` (`identifier`);--> statement-breakpoint
ALTER TABLE `device_code` ADD `resources` text;--> statement-breakpoint
ALTER TABLE `device_code` ADD `oauth_client_id` text REFERENCES oauth_client(client_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `oauth_access_token` ADD `authorization_code_id` text;--> statement-breakpoint
ALTER TABLE `oauth_access_token` ADD `resources` text;--> statement-breakpoint
ALTER TABLE `oauth_access_token` ADD `requested_user_info_claims` text;--> statement-breakpoint
ALTER TABLE `oauth_access_token` ADD `revoked` integer;--> statement-breakpoint
ALTER TABLE `oauth_access_token` ADD `confirmation` text;--> statement-breakpoint
CREATE INDEX `oauthAccessToken_authorizationCodeId_idx` ON `oauth_access_token` (`authorization_code_id`);--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `client_discovery_id` text;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `client_credentials_scopes` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `backchannel_logout_uri` text;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `backchannel_logout_session_required` integer;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `application_type` text;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `jwks` text;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `jwks_uri` text;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `dpop_bound_access_tokens` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `oauth_consent` ADD `resources` text;--> statement-breakpoint
ALTER TABLE `oauth_consent` ADD `requested_user_info_claims` text;--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD `authorization_code_id` text;--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD `requested_user_info_claims` text;--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD `rotated_at` integer;--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD `rotation_replay_response` text;--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD `rotation_replay_expires_at` integer;--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD `confirmation` text;--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_authorizationCodeId_idx` ON `oauth_refresh_token` (`authorization_code_id`);--> statement-breakpoint
ALTER TABLE `team` ADD `member_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `team_member` ADD `membership_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `team_member_membership_key_unique` ON `team_member` (`membership_key`);
--> statement-breakpoint
-- Realmroot owns the Application scope catalog; mirror only its resource scopes
-- into BA's new machine-client allowlist, excluding user-delegated OIDC scopes.
UPDATE oauth_client
SET client_credentials_scopes = (
  SELECT json_group_array(DISTINCT resource_scope.value)
  FROM application AS app, json_each(app.resource_scopes) AS resource,
    json_each(resource.value, '$.scopes') AS resource_scope
  WHERE app.oauth_client_id = oauth_client.client_id
), application_type = CASE WHEN type IN ('public_native', 'native') THEN 'native' ELSE 'web' END
WHERE EXISTS (SELECT 1 FROM application WHERE application.oauth_client_id = oauth_client.client_id);
--> statement-breakpoint
UPDATE device_code SET oauth_client_id = client_id WHERE client_id IS NOT NULL;
--> statement-breakpoint
UPDATE team SET member_count = (SELECT count(*) FROM team_member WHERE team_member.team_id = team.id);
