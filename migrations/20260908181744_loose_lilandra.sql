CREATE TABLE `account_deletion_cleanup` (
	`user_id` text PRIMARY KEY NOT NULL,
	`organization_ids` text NOT NULL,
	`asset_keys` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`claim_id` text,
	`claim_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
ALTER TABLE `user` ADD `deleted_at` integer;
--> statement-breakpoint
CREATE TRIGGER account_deletion_last_owner BEFORE INSERT ON account_deletion_cleanup
WHEN EXISTS (
  SELECT 1 FROM member m WHERE m.user_id = NEW.user_id AND (',' || m.role || ',') LIKE '%,owner,%'
  AND NOT EXISTS (SELECT 1 FROM member other JOIN user u ON u.id = other.user_id
    WHERE other.organization_id = m.organization_id AND other.user_id != NEW.user_id
    AND u.deleted_at IS NULL AND (',' || other.role || ',') LIKE '%,owner,%')
)
BEGIN SELECT RAISE(ABORT, 'account_last_owner'); END;
--> statement-breakpoint
CREATE TRIGGER account_tombstone_immutable BEFORE UPDATE ON user
WHEN OLD.deleted_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_session_insert BEFORE INSERT ON session
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_session_update BEFORE UPDATE ON session
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_account_insert BEFORE INSERT ON account
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_account_update BEFORE UPDATE ON account
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_passkey_insert BEFORE INSERT ON passkey
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_passkey_update BEFORE UPDATE ON passkey
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_two_factor_insert BEFORE INSERT ON two_factor
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_two_factor_update BEFORE UPDATE ON two_factor
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_wallet_address_insert BEFORE INSERT ON wallet_address
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_wallet_address_update BEFORE UPDATE ON wallet_address
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_user_profile_insert BEFORE INSERT ON user_profile
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_user_profile_update BEFORE UPDATE ON user_profile
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_member_insert BEFORE INSERT ON member
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_member_update BEFORE UPDATE ON member
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_team_member_insert BEFORE INSERT ON team_member
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_team_member_update BEFORE UPDATE ON team_member
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_oauth_access_token_insert BEFORE INSERT ON oauth_access_token
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_oauth_access_token_update BEFORE UPDATE ON oauth_access_token
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_oauth_refresh_token_insert BEFORE INSERT ON oauth_refresh_token
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_oauth_refresh_token_update BEFORE UPDATE ON oauth_refresh_token
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_oauth_consent_insert BEFORE INSERT ON oauth_consent
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_oauth_consent_update BEFORE UPDATE ON oauth_consent
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_device_code_insert BEFORE INSERT ON device_code
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_device_code_update BEFORE UPDATE ON device_code
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_agent_identity_insert BEFORE INSERT ON agent_identity
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.owner_user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_agent_identity_update BEFORE UPDATE ON agent_identity
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.owner_user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_agent_insert BEFORE INSERT ON agent
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_agent_update BEFORE UPDATE ON agent
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_agent_host_insert BEFORE INSERT ON agent_host
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_agent_host_update BEFORE UPDATE ON agent_host
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_provider_connection_insert BEFORE INSERT ON provider_connection
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.owner_user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_provider_connection_update BEFORE UPDATE ON provider_connection
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.owner_user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_uploaded_asset_insert BEFORE INSERT ON uploaded_asset
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.created_by_user_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_verification_insert BEFORE INSERT ON verification
WHEN EXISTS (SELECT 1 FROM user WHERE id = NEW.value AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_resource_scope_entitlement_insert BEFORE INSERT ON resource_scope_entitlement
WHEN NEW.ended_at IS NULL AND (EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL) OR EXISTS (SELECT 1 FROM agent_identity WHERE id = NEW.agent_identity_id AND deleted_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_resource_scope_entitlement_update BEFORE UPDATE ON resource_scope_entitlement
WHEN NEW.ended_at IS NULL AND (EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND deleted_at IS NOT NULL) OR EXISTS (SELECT 1 FROM agent_identity WHERE id = NEW.agent_identity_id AND deleted_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_agent_identity_binding_insert BEFORE INSERT ON agent_identity_binding
WHEN NEW.status = 'active' AND EXISTS (SELECT 1 FROM agent_identity WHERE id = NEW.agent_identity_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_agent_identity_binding_update BEFORE UPDATE ON agent_identity_binding
WHEN NEW.status = 'active' AND EXISTS (SELECT 1 FROM agent_identity WHERE id = NEW.agent_identity_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_provider_credential_insert BEFORE INSERT ON provider_credential
WHEN NEW.status = 'active' AND EXISTS (SELECT 1 FROM provider_resource_authorization a JOIN provider_connection c ON c.id = a.provider_connection_id JOIN user u ON u.id = c.owner_user_id WHERE a.id = NEW.provider_resource_authorization_id AND u.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_provider_credential_update BEFORE UPDATE ON provider_credential
WHEN NEW.status = 'active' AND EXISTS (SELECT 1 FROM provider_resource_authorization a JOIN provider_connection c ON c.id = a.provider_connection_id JOIN user u ON u.id = c.owner_user_id WHERE a.id = NEW.provider_resource_authorization_id AND u.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_provider_resource_authorization_insert BEFORE INSERT ON provider_resource_authorization
WHEN NEW.status = 'active' AND EXISTS (SELECT 1 FROM provider_connection c JOIN user u ON u.id = c.owner_user_id WHERE c.id = NEW.provider_connection_id AND u.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_provider_resource_authorization_update BEFORE UPDATE ON provider_resource_authorization
WHEN NEW.status = 'active' AND EXISTS (SELECT 1 FROM provider_connection c JOIN user u ON u.id = c.owner_user_id WHERE c.id = NEW.provider_connection_id AND u.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_external_token_lease_insert BEFORE INSERT ON external_token_lease
WHEN NEW.revoked_at IS NULL AND EXISTS (SELECT 1 FROM agent_identity_binding b JOIN agent_identity i ON i.id = b.agent_identity_id WHERE b.id = NEW.binding_id AND i.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_external_token_lease_update BEFORE UPDATE ON external_token_lease
WHEN NEW.revoked_at IS NULL AND EXISTS (SELECT 1 FROM agent_identity_binding b JOIN agent_identity i ON i.id = b.agent_identity_id WHERE b.id = NEW.binding_id AND i.deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_agent_access_request_insert BEFORE INSERT ON agent_access_request
WHEN NEW.status = 'pending' AND EXISTS (SELECT 1 FROM agent_identity WHERE id = NEW.agent_identity_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;

--> statement-breakpoint
CREATE TRIGGER account_deleted_agent_access_request_update BEFORE UPDATE ON agent_access_request
WHEN NEW.status = 'pending' AND EXISTS (SELECT 1 FROM agent_identity WHERE id = NEW.agent_identity_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account_deleted'); END;
