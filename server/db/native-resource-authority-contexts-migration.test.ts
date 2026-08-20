import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const authorityContextMigration = '20260820070000_native_resource_authority_contexts.sql'

describe('Native Resource authority Context migration', () => {
  it('[spec: platform-onboarding/existing-d1-upgrade] revokes only contextless native Agent authority', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of migrationNames().filter((name) => name < authorityContextMigration)) {
        database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      }
      database.exec(`
        INSERT INTO user (id, name, email, email_verified) VALUES ('user-1', 'User', 'user@example.com', 1);
        INSERT INTO organization (id, slug, name) VALUES ('org-1', 'org-1', 'Organization');
        INSERT INTO oauth_client (id, client_id, redirect_uris) VALUES ('oauth-1', 'client-1', '[]');
        INSERT INTO application (id, oauth_client_id, slug, name, owner_organization_id)
        VALUES ('application-1', 'client-1', 'application-1', 'Application', 'org-1');
        INSERT INTO agent_host (id, name, user_id, status, created_at, updated_at)
        VALUES ('host-1', 'Host', 'user-1', 'active', 1, 1);
        INSERT INTO agent (id, name, host_id, public_key, created_at, updated_at)
        VALUES ('protocol-agent-1', 'Agent', 'host-1', 'public-key', 1, 1);
        INSERT INTO agent_identity (
          id, issuer, subject, username, name, owner_user_id, status, created_at, updated_at
        ) VALUES (
          'agent-1', 'https://issuer.example.test', 'agent-subject',
          'agent.00000000000000000000000000000001', 'Agent', 'user-1', 'active', 1, 1
        );
        INSERT INTO agent_identity_binding (
          id, agent_identity_id, protocol_agent_id, status, bound_at, created_at, updated_at
        ) VALUES ('binding-1', 'agent-1', 'protocol-agent-1', 'active', 1, 1, 1);
        INSERT INTO api_resource (
          id, identifier, name, resource_url, authorization_model, owner_organization_id,
          authorization_details, enabled, visibility, available_to_agents
        ) VALUES
          ('native-resource', 'native-resource', 'Native', 'https://native.example.test', 'native',
           'org-1', '[]', 1, 'public', 1),
          ('external-resource', 'external-resource', 'External', 'https://external.example.test', 'external',
           'org-1', '[]', 1, 'public', 1);
        INSERT INTO agent_access_request (
          id, resource_id, agent_identity_id, binding_id, scopes, status, approval_token_hash,
          encrypted_approval_token, authorization_details, approved_entitlements, expires_at
        ) VALUES (
          'request-1', 'native-resource', 'agent-1', 'binding-1', '["read"]', 'approved',
          'approval-hash', 'sealed-token', '[]', '[]', 4102444800000
        );
        INSERT INTO resource_scope_entitlement (
          id, user_id, application_id, agent_identity_id, organization_id, resource_server_id,
          authorization_details, authorization_context_hash, scope, mode, granted_by_user_id,
          source_access_request_id, created_at, updated_at
        ) VALUES
          ('agent-native-contextless', NULL, NULL, 'agent-1', NULL, 'native-resource', '[]',
           'agent-native-none', 'read', 'persistent', 'user-1', 'request-1', 1, 1),
          ('agent-native-contextful', NULL, NULL, 'agent-1', NULL, 'native-resource',
           '[{"type":"realmroot_authority","authority":"organization","id":"org-1"}]',
           'agent-native-org', 'write', 'persistent', 'user-1', 'request-1', 1, 1),
          ('agent-external-contextless', NULL, NULL, 'agent-1', NULL, 'external-resource', '[]',
           'agent-external-none', 'read', 'persistent', 'user-1', NULL, 1, 1),
          ('user-native-contextless', 'user-1', NULL, NULL, NULL, 'native-resource', '[]',
           'user-native-none', 'read', 'persistent', 'user-1', NULL, 1, 1),
          ('application-native-contextless', NULL, 'application-1', NULL, NULL, 'native-resource', '[]',
           'application-native-none', 'read', 'persistent', 'user-1', NULL, 1, 1);
        INSERT INTO resource_scope_entitlement (
          id, agent_identity_id, resource_server_id, authorization_details, authorization_context_hash,
          scope, mode, granted_by_user_id, source_access_request_id, ended_at, end_reason, created_at, updated_at
        ) VALUES (
          'agent-native-consumed-once', 'agent-1', 'native-resource', '[]', 'agent-native-consumed',
          'consume', 'once', 'user-1', 'request-1', 2, 'consumed', 1, 2
        );
        INSERT INTO external_token_lease (
          id, entitlement_ids, request_id, binding_id, encrypted_access_token, token_hash,
          confirmation_jkt, scopes, authorization_details, expires_at
        ) VALUES
          ('legacy-lease', '["agent-native-contextless"]', 'request-1', 'binding-1', 'sealed',
           'legacy-hash', 'legacy-jkt', '["read"]', '[]', 4102444800000),
          ('contextful-lease', '["agent-native-contextful"]', 'request-1', 'binding-1', 'sealed',
           'contextful-hash', 'contextful-jkt', '["write"]',
           '[{"type":"realmroot_authority","authority":"organization","id":"org-1"}]', 4102444800000),
          ('consumed-once-lease', '["agent-native-consumed-once"]', 'request-1', 'binding-1', 'sealed',
           'consumed-once-hash', 'consumed-once-jkt', '["consume"]', '[]', 4102444800000);
      `)

      database.exec(readFileSync(new URL(`../../migrations/${authorityContextMigration}`, import.meta.url), 'utf8'))

      expect(
        database.prepare('SELECT id, end_reason AS endReason FROM resource_scope_entitlement ORDER BY id').all(),
      ).toEqual([
        { id: 'agent-external-contextless', endReason: null },
        { id: 'agent-native-consumed-once', endReason: 'consumed' },
        { id: 'agent-native-contextful', endReason: null },
        { id: 'agent-native-contextless', endReason: 'revoked' },
        { id: 'application-native-contextless', endReason: null },
        { id: 'user-native-contextless', endReason: null },
      ])
      expect(
        database.prepare('SELECT id, revoked_at IS NOT NULL AS revoked FROM external_token_lease ORDER BY id').all(),
      ).toEqual([
        { id: 'consumed-once-lease', revoked: 1 },
        { id: 'contextful-lease', revoked: 0 },
        { id: 'legacy-lease', revoked: 1 },
      ])
      expect(database.prepare("SELECT id, status FROM agent_access_request WHERE id = 'request-1'").get()).toEqual({
        id: 'request-1',
        status: 'approved',
      })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
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
