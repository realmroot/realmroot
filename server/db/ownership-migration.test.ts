import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const migrationName = '20260806005241_same_mathemanic.sql'
const platformOwnerMigrationName = '20260806040000_platform_organization_owner.sql'
const resourceScopeMigrationName = '20260806155546_typical_demogoblin.sql'
const consentScopeMigrationName = '20260806190437_brown_sabra.sql'
const rfc9728ScopeRegistryMigrationName = '20260806214840_rfc9728_scope_registry.sql'
const lifecycleMigrationName = '20260807004611_unique_weapon_omega.sql'
const providerConnectionMigrationName = '20260808175918_brokered_provider_connections.sql'
const resourceAccessModeMigrationName = '20260808205043_talented_the_call.sql'
const providerConnectionEventMigrationName = '20260809023858_swift_patriot.sql'
const entitlementMigrationName = '20260809163141_bouncy_madame_hydra.sql'
const permissionGrantActorMigrationName = '20260810145702_permission_grant_actor.sql'
const clientTypesMigrationName = '20260810153434_application_types.sql'
const providerCredentialRefreshMigrationName = '20260810224255_polite_tombstone.sql'
const systemResourceUuidMigrationName = '20260812132947_system_resource_uuidv7.sql'
const applicationConsentRequiredMigrationName = '20260812140338_application_consent_required.sql'
const applicationAuthorizationSourceMigrationName = '20260812142042_application_authorization_source.sql'
const resourceAuthorizationConnectorsMigrationName = '20260813061753_resource_authorization_connectors.sql'
const adaptersLinearPermissionsMigrationName = '20260813074009_adapters_linear_permissions.sql'
const authorizationModelMigrationName = '20260813153528_natural_zaran.sql'
const providerCredentialMigrationName = '20260813153617_big_captain_britain.sql'
const externalAuthorizationCleanupMigrationName = '20260813164303_past_metal_master.sql'
const authorityConstraintCleanupMigrationName = '20260813165958_sparkling_jimmy_woo.sql'
const linearWorkspaceConnectionMigrationName = '20260813184104_linear_workspace_connection.sql'
const linearAuthorizationCleanupMigrationName = '20260813184558_revoke_legacy_linear_authorization.sql'
const providerIdentityAlignmentMigrationName = '20260813184930_align_resource_provider_identity.sql'
const scopeRegistryCleanupMigrationName = '20260813204636_remove_account_connection_scope_registry.sql'
const staleEntitlementCleanupMigrationName = '20260813211853_cleanup_stale_agent_entitlements.sql'

describe('tenant ownership migration', () => {
  it('backfills authority constraints for existing brokered connections', () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec(`
        CREATE TABLE provider_resource_authorization (
          id text PRIMARY KEY NOT NULL,
          credential_custody text NOT NULL,
          authorization_details text NOT NULL,
          granted_scopes text NOT NULL
        );
        INSERT INTO provider_resource_authorization VALUES
          ('brokered', 'resource_server', '[{"type":"provider_installation","installation_id":"1"}]', '["contents:read"]'),
          ('native', 'realmroot', '[{"type":"account"}]', '["profile:read"]');
      `)

      database.exec(
        readFileSync(new URL(`../../migrations/${providerConnectionEventMigrationName}`, import.meta.url), 'utf8'),
      )

      const brokered = database
        .prepare(
          "select authority_constraints as constraints from provider_resource_authorization where id = 'brokered'",
        )
        .get() as { constraints: string }
      const native = database
        .prepare("select authority_constraints as constraints from provider_resource_authorization where id = 'native'")
        .get() as { constraints: string }
      expect(JSON.parse(brokered.constraints)).toEqual([
        {
          authorizationDetails: [{ type: 'provider_installation', installation_id: '1' }],
          scopes: ['contents:read'],
        },
      ])
      expect(JSON.parse(native.constraints)).toEqual([])
    } finally {
      database.close()
    }
  })

  it('rebuilds legacy ownership into the final schema and quarantines ambiguity', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of migrationNames().filter(
        (name) =>
          ![
            migrationName,
            platformOwnerMigrationName,
            resourceScopeMigrationName,
            consentScopeMigrationName,
            rfc9728ScopeRegistryMigrationName,
            lifecycleMigrationName,
            providerConnectionMigrationName,
            resourceAccessModeMigrationName,
            providerConnectionEventMigrationName,
            entitlementMigrationName,
            permissionGrantActorMigrationName,
            clientTypesMigrationName,
            providerCredentialRefreshMigrationName,
            systemResourceUuidMigrationName,
            applicationConsentRequiredMigrationName,
            applicationAuthorizationSourceMigrationName,
            resourceAuthorizationConnectorsMigrationName,
            adaptersLinearPermissionsMigrationName,
            authorizationModelMigrationName,
            providerCredentialMigrationName,
            externalAuthorizationCleanupMigrationName,
            authorityConstraintCleanupMigrationName,
            linearWorkspaceConnectionMigrationName,
            linearAuthorizationCleanupMigrationName,
            providerIdentityAlignmentMigrationName,
            scopeRegistryCleanupMigrationName,
            staleEntitlementCleanupMigrationName,
          ].includes(name),
      )) {
        database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      }
      seedCurrentSchema(database)
      database.exec('pragma foreign_keys = on; begin')
      try {
        database.exec(readFileSync(new URL(`../../migrations/${migrationName}`, import.meta.url), 'utf8'))
        database.exec(readFileSync(new URL(`../../migrations/${platformOwnerMigrationName}`, import.meta.url), 'utf8'))
        database.exec('commit')
      } catch (error) {
        database.exec('rollback')
        throw error
      }
      database.exec(readFileSync(new URL(`../../migrations/${resourceScopeMigrationName}`, import.meta.url), 'utf8'))
      database.exec(readFileSync(new URL(`../../migrations/${consentScopeMigrationName}`, import.meta.url), 'utf8'))
      database.exec(
        readFileSync(new URL(`../../migrations/${rfc9728ScopeRegistryMigrationName}`, import.meta.url), 'utf8'),
      )
      database.exec(readFileSync(new URL(`../../migrations/${lifecycleMigrationName}`, import.meta.url), 'utf8'))
      database.exec(
        readFileSync(new URL(`../../migrations/${providerConnectionMigrationName}`, import.meta.url), 'utf8'),
      )
      database.exec(
        readFileSync(new URL(`../../migrations/${resourceAccessModeMigrationName}`, import.meta.url), 'utf8'),
      )
      database.exec(
        readFileSync(new URL(`../../migrations/${providerConnectionEventMigrationName}`, import.meta.url), 'utf8'),
      )
      database.exec(readFileSync(new URL(`../../migrations/${entitlementMigrationName}`, import.meta.url), 'utf8'))
      database.exec(
        readFileSync(new URL(`../../migrations/${providerCredentialRefreshMigrationName}`, import.meta.url), 'utf8'),
      )
      database.exec(
        readFileSync(
          new URL(`../../migrations/${resourceAuthorizationConnectorsMigrationName}`, import.meta.url),
          'utf8',
        ),
      )
      database.exec(
        readFileSync(new URL(`../../migrations/${adaptersLinearPermissionsMigrationName}`, import.meta.url), 'utf8'),
      )
      database.exec(
        readFileSync(new URL(`../../migrations/${authorizationModelMigrationName}`, import.meta.url), 'utf8'),
      )
      database.exec(
        readFileSync(new URL(`../../migrations/${providerCredentialMigrationName}`, import.meta.url), 'utf8'),
      )
      database.exec(
        readFileSync(new URL(`../../migrations/${externalAuthorizationCleanupMigrationName}`, import.meta.url), 'utf8'),
      )
      database.exec(
        readFileSync(new URL(`../../migrations/${authorityConstraintCleanupMigrationName}`, import.meta.url), 'utf8'),
      )
      database.exec(
        readFileSync(new URL(`../../migrations/${linearWorkspaceConnectionMigrationName}`, import.meta.url), 'utf8'),
      )
      database.exec(
        readFileSync(new URL(`../../migrations/${linearAuthorizationCleanupMigrationName}`, import.meta.url), 'utf8'),
      )
      database.exec(
        readFileSync(new URL(`../../migrations/${providerIdentityAlignmentMigrationName}`, import.meta.url), 'utf8'),
      )
      database.exec(
        readFileSync(new URL(`../../migrations/${scopeRegistryCleanupMigrationName}`, import.meta.url), 'utf8'),
      )
      database.exec(
        readFileSync(new URL(`../../migrations/${staleEntitlementCleanupMigrationName}`, import.meta.url), 'utf8'),
      )

      expect(columnNames(database, 'application')).not.toContain('owner_user_id')
      expect(columnNames(database, 'application')).not.toContain('audience_mode')
      expect(columnNames(database, 'application')).toEqual(expect.arrayContaining(['oidc_scopes', 'resource_scopes']))
      expect(columnNames(database, 'application_consent')).not.toContain('organization_id')
      expect(columnNames(database, 'application_consent')).not.toContain('permissions')
      expect(columnNames(database, 'provider_credential')).not.toContain('authority_constraints')
      expect(database.prepare("select id from application_consent where id = 'consent-1'").get()).toEqual({
        id: 'consent-1',
      })
      for (const table of [
        'account_center_setting',
        'application_client_metadata',
        'application_client_secret',
        'branding_setting',
        'custom_domain',
        'federated_credential',
      ]) {
        expect(database.prepare(`select count(*) as count from ${table}`).get()).toEqual({ count: 1 })
      }
      expect(
        database
          .prepare("select revoked_at is not null as revoked from application_consent where id = 'consent-1'")
          .get(),
      ).toEqual({ revoked: 1 })
      expect(
        database.prepare("select default_application_id from sign_in_experience where id = 'signin-1'").get(),
      ).toEqual({ default_application_id: 'app-1' })
      expect(columnNames(database, 'resource_connection_intent')).toContain('initiated_by_user_id')
      expect(
        database
          .prepare(
            'select owner_user_id, owner_organization_id, initiated_by_user_id from resource_connection_intent where id = ?',
          )
          .get('intent-org'),
      ).toEqual({ initiated_by_user_id: 'user-1', owner_organization_id: 'org-1', owner_user_id: null })
      expect(database.prepare("select user_id, role from member where organization_id = 'org_platform'").get()).toEqual(
        { user_id: 'user-1', role: 'owner' },
      )
      expect(database.prepare("select status from agent_identity where id = 'platform-agent'").get()).toEqual({
        status: 'inactive',
      })
      expect(
        database
          .prepare(
            "select realm_owned, owner_user_id, owner_organization_id from agent_audit_event where id = 'audit-realm'",
          )
          .get(),
      ).toEqual({
        owner_organization_id: 'org_platform',
        owner_user_id: null,
        realm_owned: 0,
      })
      expect(
        database
          .prepare(
            "select realm_owned, owner_user_id, owner_organization_id from agent_audit_event where id = 'audit-org'",
          )
          .get(),
      ).toEqual({
        owner_organization_id: 'org-1',
        owner_user_id: null,
        realm_owned: 0,
      })
      expect(
        database
          .prepare(
            "select realm_owned, owner_user_id, owner_organization_id from agent_audit_event where id = 'audit-grant'",
          )
          .get(),
      ).toEqual({
        owner_organization_id: 'org_platform',
        owner_user_id: null,
        realm_owned: 0,
      })
      expect(
        database
          .prepare('select source_table, source_id, reason_code from ownership_quarantine order by source_id')
          .all(),
      ).toEqual([
        {
          reason_code: 'owner_conflict',
          source_id: 'audit-conflict',
          source_table: 'agent_audit_event',
        },
        {
          reason_code: 'owner_reference_invalid',
          source_id: 'audit-invalid-owner',
          source_table: 'agent_audit_event',
        },
        {
          reason_code: 'owner_not_determinable',
          source_id: 'audit-unknown',
          source_table: 'agent_audit_event',
        },
      ])
      expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })
})

function migrationNames() {
  return readdirSync(new URL('../../migrations', import.meta.url))
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

function columnNames(database: DatabaseSync, table: string) {
  return database
    .prepare(`pragma table_info(${table})`)
    .all()
    .map((row) => String(row.name))
}

function seedCurrentSchema(database: DatabaseSync) {
  database.exec(`
    insert into user (id, name, email, email_verified, role, created_at, updated_at)
    values
      ('user-0', 'Earlier User', 'user-0@example.test', 1, 'user', 0, 0),
      ('user-1', 'User One', 'user-1@example.test', 1, 'user,admin', 1, 1);
    insert into organization (id, slug, name, created_at, updated_at)
    values ('org-1', 'org-1', 'Organization One', 1, 1);
    insert into member (id, organization_id, user_id, role, created_at, updated_at)
    values ('platform-member', 'org_platform', 'user-1', 'owner', 1, 1);
    insert into organization_role (id, organization_id, role, permission, display_name, created_at, updated_at)
    values ('platform-role', 'org_platform', 'custom', '{}', 'Custom', 1, 1);
    insert into oauth_client (id, client_id, redirect_uris, created_at, updated_at)
    values ('oauth-1', 'client-1', '[]', 1, 1);
    insert into application (id, oauth_client_id, slug, name, owner_organization_id, audience_mode, created_at, updated_at)
    values ('app-1', 'client-1', 'app-1', 'Application', 'org-1', 'realm', 1, 1);
    insert into application_consent (id, application_id, user_id, organization_id, scopes, granted_at)
    values ('consent-1', 'app-1', 'user-1', 'org-1', '["openid"]', 1);
    insert into application_audience_organization (application_id, organization_id, created_at)
    values ('app-1', 'org-1', 1);
    insert into application_audience_user (application_id, user_id, created_at)
    values ('app-1', 'user-1', 1);
    insert into application_client_metadata (application_id, access_review_status, updated_at)
    values ('app-1', 'approved', 1);
    insert into application_client_secret (id, application_id, version, secret_hash, status, created_at)
    values ('secret-1', 'app-1', 1, 'hash', 'active', 1);
    insert into branding_setting (id, application_id, updated_at) values ('branding-1', 'app-1', 1);
    insert into account_center_setting (id, application_id, updated_at) values ('account-center-1', 'app-1', 1);
    insert into custom_domain (id, hostname, application_id, status, verification_token, created_at, updated_at)
    values ('domain-1', 'app.example.test', 'app-1', 'pending', 'verify-1', 1, 1);
    insert into api_resource (id, identifier, name, resource_url, enabled, owner_organization_id, created_at, updated_at)
    values ('resource-1', 'resource-1', 'Resource', 'https://resource.example.test', 1, 'org_platform', 1, 1);
    insert into federated_credential (id, application_id, name, issuer, subject, audience_resource_id, enabled, created_at, updated_at)
    values ('credential-1', 'app-1', 'Credential', 'https://issuer.example.test', 'subject-1', 'resource-1', 1, 1, 1);
    insert into sign_in_experience (id, default_application_id, updated_at) values ('signin-1', 'app-1', 1);
    insert into resource_connection_intent (
      id, state_hash, resource_id, owner_user_id, owner_organization_id, scopes,
      encrypted_pkce_verifier, status, expires_at, created_at, updated_at
    ) values ('intent-org', 'state-1', 'resource-1', 'user-1', 'org-1', '[]', 'sealed', 'pending', 100, 1, 1);
    insert into agent_identity (id, issuer, subject, username, name, owner_organization_id, status, created_at, updated_at)
    values ('agent-1', 'https://issuer.example.test', 'agent-1', 'agent.00000000000000000000000000000001', 'Agent', 'org-1', 'active', 1, 1);
    insert into agent_identity (id, issuer, subject, username, name, owner_organization_id, status, created_at, updated_at)
    values ('platform-agent', 'https://issuer.example.test', 'platform-agent', 'platform-agent.00000000000000000000000000000002', 'Platform Agent', 'org_platform', 'active', 1, 1);
    insert into agent_access_grant (
      id, resource_id, agent_identity_id, scopes, mode, status, granted_by_user_id, created_at, updated_at
    ) values ('platform-grant', 'resource-1', 'platform-agent', '[]', 'direct', 'active', 'user-1', 1, 1);
    insert into agent_audit_event (id, action, result, agent_identity_id, occurred_at)
    values ('audit-org', 'agent.updated', 'allowed', 'agent-1', 1);
    insert into agent_audit_event (id, action, result, resource_id, occurred_at)
    values ('audit-realm', 'resource.updated', 'allowed', 'resource-1', 1);
    insert into agent_audit_event (id, action, result, access_grant_id, occurred_at)
    values ('audit-grant', 'grant.updated', 'allowed', 'platform-grant', 1);
    insert into agent_audit_event (id, action, result, agent_identity_id, resource_id, occurred_at)
    values ('audit-conflict', 'legacy.conflict', 'allowed', 'agent-1', 'resource-1', 1);
    insert into agent_audit_event (id, action, result, metadata, occurred_at)
    values ('audit-invalid-owner', 'legacy.invalid-owner', 'allowed', '{"organizationId":"org-missing"}', 1);
    insert into agent_audit_event (id, action, result, occurred_at)
    values ('audit-unknown', 'legacy.unknown', 'allowed', 1);
  `)
}
