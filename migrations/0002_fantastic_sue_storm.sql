CREATE TABLE `account_center_setting` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text,
	`profile_editing_enabled` integer DEFAULT true NOT NULL,
	`password_change_enabled` integer DEFAULT true NOT NULL,
	`connected_accounts_enabled` integer DEFAULT true NOT NULL,
	`sessions_view_enabled` integer DEFAULT true NOT NULL,
	`danger_zone_enabled` integer DEFAULT false NOT NULL,
	`metadata` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accountCenterSetting_applicationId_idx` ON `account_center_setting` (`application_id`);--> statement-breakpoint
CREATE TABLE `api_permission` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`scope_id` text,
	`key` text NOT NULL,
	`description` text,
	`token_claim_value` text,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scope_id`) REFERENCES `api_scope`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apiPermission_resourceId_key_unique` ON `api_permission` (`resource_id`,`key`);--> statement-breakpoint
CREATE INDEX `apiPermission_scopeId_idx` ON `api_permission` (`scope_id`);--> statement-breakpoint
CREATE TABLE `api_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`name` text NOT NULL,
	`audience` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`token_claims_namespace` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_resource_identifier_unique` ON `api_resource` (`identifier`);--> statement-breakpoint
CREATE INDEX `apiResource_enabled_idx` ON `api_resource` (`enabled`);--> statement-breakpoint
CREATE TABLE `api_scope` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`required` integer DEFAULT false NOT NULL,
	`token_claim_name` text,
	`include_in_access_token` integer DEFAULT true NOT NULL,
	`include_in_id_token` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apiScope_resourceId_value_unique` ON `api_scope` (`resource_id`,`value`);--> statement-breakpoint
CREATE INDEX `apiScope_resourceId_idx` ON `api_scope` (`resource_id`);--> statement-breakpoint
CREATE TABLE `application` (
	`id` text PRIMARY KEY NOT NULL,
	`oauth_client_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`homepage_url` text,
	`logo_asset_id` text,
	`owner_user_id` text,
	`owner_organization_id` text,
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
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_slug_unique` ON `application` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_oauthClientId_unique` ON `application` (`oauth_client_id`);--> statement-breakpoint
CREATE INDEX `application_ownerUserId_idx` ON `application` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `application_ownerOrganizationId_idx` ON `application` (`owner_organization_id`);--> statement-breakpoint
CREATE INDEX `application_disabled_idx` ON `application` (`disabled`);--> statement-breakpoint
CREATE TABLE `application_client_metadata` (
	`application_id` text PRIMARY KEY NOT NULL,
	`access_review_status` text DEFAULT 'pending' NOT NULL,
	`access_review_notes` text,
	`allowed_environments` text,
	`admin_metadata` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `application_client_secret` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`version` integer NOT NULL,
	`secret_hash` text NOT NULL,
	`secret_prefix` text,
	`status` text DEFAULT 'active' NOT NULL,
	`materialized_to_oauth_client_at` integer,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applicationClientSecret_applicationId_version_unique` ON `application_client_secret` (`application_id`,`version`);--> statement-breakpoint
CREATE INDEX `applicationClientSecret_applicationId_status_idx` ON `application_client_secret` (`application_id`,`status`);--> statement-breakpoint
CREATE INDEX `applicationClientSecret_createdByUserId_idx` ON `application_client_secret` (`created_by_user_id`);--> statement-breakpoint
CREATE TABLE `application_consent` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text,
	`scopes` text NOT NULL,
	`permissions` text,
	`granted_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `applicationConsent_applicationId_idx` ON `application_consent` (`application_id`);--> statement-breakpoint
CREATE INDEX `applicationConsent_userId_idx` ON `application_consent` (`user_id`);--> statement-breakpoint
CREATE INDEX `applicationConsent_organizationId_idx` ON `application_consent` (`organization_id`);--> statement-breakpoint
CREATE TABLE `application_role_assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`application_id` text NOT NULL,
	`assigned_by_user_id` text,
	`token_claims` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applicationRoleAssignment_roleId_applicationId_unique` ON `application_role_assignment` (`role_id`,`application_id`);--> statement-breakpoint
CREATE INDEX `applicationRoleAssignment_roleId_idx` ON `application_role_assignment` (`role_id`);--> statement-breakpoint
CREATE INDEX `applicationRoleAssignment_applicationId_idx` ON `application_role_assignment` (`application_id`);--> statement-breakpoint
CREATE TABLE `branding_setting` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text,
	`organization_id` text,
	`logo_asset_id` text,
	`favicon_asset_id` text,
	`primary_color` text,
	`background_color` text,
	`custom_css` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`logo_asset_id`) REFERENCES `uploaded_asset`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`favicon_asset_id`) REFERENCES `uploaded_asset`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `brandingSetting_applicationId_idx` ON `branding_setting` (`application_id`);--> statement-breakpoint
CREATE INDEX `brandingSetting_organizationId_idx` ON `branding_setting` (`organization_id`);--> statement-breakpoint
CREATE TABLE `custom_domain` (
	`id` text PRIMARY KEY NOT NULL,
	`hostname` text NOT NULL,
	`application_id` text,
	`organization_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`verification_token` text NOT NULL,
	`cname_target` text,
	`tls_status` text,
	`verified_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_domain_hostname_unique` ON `custom_domain` (`hostname`);--> statement-breakpoint
CREATE UNIQUE INDEX `custom_domain_verification_token_unique` ON `custom_domain` (`verification_token`);--> statement-breakpoint
CREATE INDEX `customDomain_applicationId_idx` ON `custom_domain` (`application_id`);--> statement-breakpoint
CREATE INDEX `customDomain_organizationId_idx` ON `custom_domain` (`organization_id`);--> statement-breakpoint
CREATE INDEX `customDomain_status_idx` ON `custom_domain` (`status`);--> statement-breakpoint
CREATE TABLE `deployment_setting` (
	`id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`base_url` text NOT NULL,
	`issuer_path` text DEFAULT '/api/auth' NOT NULL,
	`cookie_domain` text,
	`metadata` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_setting_environment_unique` ON `deployment_setting` (`environment`);--> statement-breakpoint
CREATE TABLE `email_service_config` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'cloudflare_email' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`from_email` text NOT NULL,
	`from_name` text,
	`reply_to_email` text,
	`default_locale` text,
	`metadata` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `identity_provider_connector` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`provider_type` text NOT NULL,
	`provider_id` text NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`client_id` text,
	`client_secret_binding` text,
	`issuer` text,
	`authorization_endpoint` text,
	`token_endpoint` text,
	`user_info_endpoint` text,
	`jwks_endpoint` text,
	`scopes` text,
	`attribute_mapping` text,
	`provider_metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_provider_connector_slug_unique` ON `identity_provider_connector` (`slug`);--> statement-breakpoint
CREATE INDEX `identityProviderConnector_providerType_idx` ON `identity_provider_connector` (`provider_type`);--> statement-breakpoint
CREATE INDEX `identityProviderConnector_enabled_idx` ON `identity_provider_connector` (`enabled`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`inviter_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`token_hash` text,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_token_hash_unique` ON `invitation` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE INDEX `invitation_inviterId_idx` ON `invitation` (`inviter_id`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`title` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_organizationId_userId_unique` ON `member` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE INDEX `member_role_idx` ON `member` (`role`);--> statement-breakpoint
CREATE TABLE `member_role_assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`member_id` text NOT NULL,
	`assigned_by_user_id` text,
	`token_claims` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberRoleAssignment_roleId_memberId_unique` ON `member_role_assignment` (`role_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `memberRoleAssignment_roleId_idx` ON `member_role_assignment` (`role_id`);--> statement-breakpoint
CREATE INDEX `memberRoleAssignment_memberId_idx` ON `member_role_assignment` (`member_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`logo` text,
	`display_name` text,
	`logo_asset_id` text,
	`disabled` integer DEFAULT false NOT NULL,
	`disabled_reason` text,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`logo_asset_id`) REFERENCES `uploaded_asset`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE INDEX `organization_logoAssetId_idx` ON `organization` (`logo_asset_id`);--> statement-breakpoint
CREATE TABLE `role` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`resource_id` text,
	`organization_id` text,
	`application_id` text,
	`system` integer DEFAULT false NOT NULL,
	`token_claim_name` text,
	`token_claim_value` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `api_resource`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `role_key_idx` ON `role` (`key`);--> statement-breakpoint
CREATE INDEX `role_resourceId_idx` ON `role` (`resource_id`);--> statement-breakpoint
CREATE INDEX `role_organizationId_idx` ON `role` (`organization_id`);--> statement-breakpoint
CREATE INDEX `role_applicationId_idx` ON `role` (`application_id`);--> statement-breakpoint
CREATE TABLE `role_permission` (
	`role_id` text NOT NULL,
	`permission_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`permission_id`) REFERENCES `api_permission`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rolePermission_roleId_permissionId_unique` ON `role_permission` (`role_id`,`permission_id`);--> statement-breakpoint
CREATE TABLE `sign_in_experience` (
	`id` text PRIMARY KEY NOT NULL,
	`default_application_id` text,
	`password_enabled` integer DEFAULT true NOT NULL,
	`signup_enabled` integer DEFAULT true NOT NULL,
	`social_login_enabled` integer DEFAULT true NOT NULL,
	`identifier_first` integer DEFAULT false NOT NULL,
	`default_redirect_uri` text,
	`terms_uri` text,
	`privacy_uri` text,
	`support_email` text,
	`metadata` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`default_application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `uploaded_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`storage_key` text NOT NULL,
	`public_url` text,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`checksum_sha256` text,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uploaded_asset_storage_key_unique` ON `uploaded_asset` (`storage_key`);--> statement-breakpoint
CREATE INDEX `uploadedAsset_purpose_idx` ON `uploaded_asset` (`purpose`);--> statement-breakpoint
CREATE INDEX `uploadedAsset_createdByUserId_idx` ON `uploaded_asset` (`created_by_user_id`);--> statement-breakpoint
CREATE TABLE `user_role_assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`user_id` text NOT NULL,
	`assigned_by_user_id` text,
	`token_claims` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `userRoleAssignment_roleId_userId_unique` ON `user_role_assignment` (`role_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `userRoleAssignment_roleId_idx` ON `user_role_assignment` (`role_id`);--> statement-breakpoint
CREATE INDEX `userRoleAssignment_userId_idx` ON `user_role_assignment` (`user_id`);--> statement-breakpoint
ALTER TABLE `session` ADD `active_organization_id` text;