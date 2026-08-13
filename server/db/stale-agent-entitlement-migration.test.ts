import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const cleanupMigration = '20260813211853_cleanup_stale_agent_entitlements.sql'

describe('Stale Agent Entitlement migration', () => {
  it('[spec: platform-onboarding/existing-d1-upgrade] ends permissions outside the current authorization model', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of migrationNames().filter((name) => name < cleanupMigration)) {
        database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      }
      database.exec('PRAGMA foreign_keys = OFF')
      database.exec(`
        INSERT INTO api_resource (
          id, identifier, name, resource_url, authorization_model, owner_organization_id,
          authorization_details, enabled, visibility, available_to_agents, created_at, updated_at
        ) VALUES
          ('native-resource', 'native-resource', 'Native', 'https://native.example.test', 'native',
           'organization-1', '[]', 1, 'private', 1, 1, 1),
          ('external-resource', 'external-resource', 'External', 'https://external.example.test', 'external',
           'organization-1', '[]', 1, 'private', 1, 1, 1);

        INSERT INTO provider_resource_authorization (
          id, provider_connection_id, resource_id, status, created_at, updated_at
        ) VALUES
          ('active-authorization', 'active-connection', 'external-resource', 'active', 1, 1),
          ('revoked-authorization', 'revoked-connection', 'external-resource', 'revoked', 1, 1);
        INSERT INTO provider_connection (
          id, connector_id, owner_user_id, external_subject, display_name, status, created_at, updated_at
        ) VALUES
          ('active-connection', 'connector-1', 'user-1', 'active', 'Active', 'active', 1, 1),
          ('revoked-connection', 'connector-1', 'user-2', 'revoked', 'Revoked', 'revoked', 1, 1);
        INSERT INTO provider_credential (
          id, provider_resource_authorization_id, external_subject, display_name, encrypted_tokens,
          granted_scopes, authorization_details, status, created_at, updated_at
        ) VALUES
          ('active-credential', 'active-authorization', 'active', 'Active', 'sealed',
           '["read"]', '[]', 'active', 1, 1),
          ('revoked-credential', 'revoked-authorization', 'revoked', 'Revoked', 'sealed',
           '["read"]', '[]', 'revoked', 1, 1);

        INSERT INTO resource_scope_entitlement (
          id, agent_identity_id, resource_server_id, connection_id, authorization_details,
          authorization_context_hash, scope, mode, granted_by_user_id, ended_at, end_reason,
          created_at, updated_at
        ) VALUES
          ('legacy-authority', 'agent-1', 'native-resource', NULL,
           '[{"type":"realmroot_authority","authority":"organization","id":"org_platform"}]',
           'legacy-hash', 'applications:write', 'persistent', 'user-1', NULL, NULL, 1, 1),
          ('current-authority', 'agent-1', 'native-resource', NULL,
           '[{"type":"realmroot_authority","authority":"organization","id":"organization-1"}]',
           'current-hash', 'applications:read', 'persistent', 'user-1', NULL, NULL, 1, 1),
          ('unbound-external', 'agent-1', 'external-resource', NULL, '[]',
           'unbound-hash', 'read', 'persistent', 'user-1', NULL, NULL, 1, 1),
          ('revoked-external', 'agent-1', 'external-resource', 'revoked-authorization', '[]',
           'revoked-hash', 'read', 'persistent', 'user-1', NULL, NULL, 1, 1),
          ('scope-no-longer-granted', 'agent-1', 'external-resource', 'active-authorization', '[]',
           'missing-scope-hash', 'write', 'persistent', 'user-1', NULL, NULL, 1, 1),
          ('active-external', 'agent-1', 'external-resource', 'active-authorization', '[]',
           'active-hash', 'read', 'persistent', 'user-1', NULL, NULL, 1, 1);
      `)

      database.exec(readFileSync(new URL(`../../migrations/${cleanupMigration}`, import.meta.url), 'utf8'))

      expect(
        database.prepare('SELECT id, end_reason AS endReason FROM resource_scope_entitlement ORDER BY id').all(),
      ).toEqual([
        { id: 'active-external', endReason: null },
        { id: 'current-authority', endReason: null },
        { id: 'legacy-authority', endReason: 'revoked' },
        { id: 'revoked-external', endReason: 'revoked' },
        { id: 'scope-no-longer-granted', endReason: 'revoked' },
        { id: 'unbound-external', endReason: 'revoked' },
      ])
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
