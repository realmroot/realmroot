import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const entitlementMigration = '20260809163141_bouncy_madame_hydra.sql'

describe('Resource Scope Entitlement migration', () => {
  it('expands legacy grants by scope, merges duplicates, and preserves request and lease snapshots', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of readdirSync(new URL('../../migrations', import.meta.url))
        .filter((name) => name.endsWith('.sql') && name < entitlementMigration)
        .sort()) {
        database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      }
      database.exec('PRAGMA foreign_keys = OFF')
      database.exec(`
        INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
        VALUES ('admin', 'Admin', 'admin@example.com', 1, 1, 1), ('user-1', 'User', 'user@example.com', 1, 1, 1);
        INSERT INTO organization (id, slug, name, disabled, created_at, updated_at)
        VALUES ('org-1', 'org-1', 'Organization', 0, 1, 1);
        INSERT INTO application (
          id, oauth_client_id, slug, name, owner_organization_id, first_party, trusted, disabled,
          created_at, updated_at, oidc_scopes, resource_scopes
        ) VALUES ('app-1', 'client-1', 'app-1', 'Application', 'org-1', 0, 0, 0, 1, 1, '[]', '[]');
        INSERT INTO api_resource (
          id, identifier, name, resource_url, owner_organization_id, enabled, created_at, updated_at, available_to_agents,
          authorization_details, visibility, access_mode
        ) VALUES ('resource-1', 'resource-1', 'Resource', 'https://api.example.com', 'org-1', 1, 1, 1, 1, '[]', 'public', 'realmroot');
        INSERT INTO agent_identity (id, issuer, subject, name, owner_user_id, status, created_at, updated_at)
        VALUES ('agent-1', 'https://issuer.example.com', 'agent-subject', 'Agent', 'user-1', 'active', 1, 1);
        INSERT INTO agent_identity_binding (
          id, agent_identity_id, protocol_agent_id, status, bound_at, created_at, updated_at
        ) VALUES ('binding-1', 'agent-1', 'protocol-agent', 'active', 1, 1, 1);

        INSERT INTO user_scope_grant VALUES
          ('user-persistent', 'user-1', 'org-1', 'resource-1', '["read"]', 'admin', NULL, NULL, 1),
          ('user-limited', 'user-1', 'org-1', 'resource-1', '["read"]', 'admin', 4102444800000, NULL, 2);
        INSERT INTO application_scope_grant VALUES
          ('application-grant', 'app-1', 'resource-1', '["read","write"]', 'admin', NULL, NULL, 1);
        INSERT INTO agent_access_grant VALUES
          ('agent-grant', 'resource-1', NULL, 'agent-1', '["read","write"]', 'once', 'active', 'admin', NULL, NULL, 1, 1, '[]');
        INSERT INTO agent_access_request (
          id, resource_id, connection_id, agent_identity_id, binding_id, scopes, reason, status,
          approval_token_hash, encrypted_approval_token, grant_id, expires_at, decided_at, created_at,
          updated_at, authorization_details
        ) VALUES (
          'request-1', 'resource-1', NULL, 'agent-1', 'binding-1', '["read","write"]', NULL, 'approved',
          'approval-hash', 'sealed-token', 'agent-grant', 4102444800000, 2, 1, 2, '[]'
        );
        INSERT INTO external_token_lease (
          id, grant_id, request_id, binding_id, encrypted_access_token, token_hash, confirmation_jkt,
          scopes, expires_at, revoked_at, created_at, authorization_details
        ) VALUES (
          'lease-1', 'agent-grant', 'request-1', 'binding-1', 'sealed-access', 'token-hash', 'jkt',
          '["read","write"]', 4102444800000, NULL, 2, '[]'
        );
      `)

      database.exec(readFileSync(new URL(`../../migrations/${entitlementMigration}`, import.meta.url), 'utf8'))

      const activeUser = database
        .prepare(
          `SELECT mode FROM resource_scope_entitlement WHERE user_id = 'user-1' AND scope = 'read' AND ended_at IS NULL`,
        )
        .all()
      const mergedUser = database
        .prepare(
          `SELECT end_reason FROM resource_scope_entitlement WHERE user_id = 'user-1' AND scope = 'read' AND ended_at IS NOT NULL`,
        )
        .all()
      expect(activeUser).toEqual([{ mode: 'persistent' }])
      expect(mergedUser).toEqual([{ end_reason: 'merged' }])
      expect(
        database
          .prepare(`SELECT count(*) AS count FROM resource_scope_entitlement WHERE application_id = 'app-1'`)
          .get(),
      ).toEqual({ count: 2 })
      expect(
        JSON.parse(
          database.prepare(`SELECT approved_entitlements FROM agent_access_request WHERE id = 'request-1'`).get()!
            .approved_entitlements as string,
        ),
      ).toEqual([
        { scope: 'read', entitlementId: expect.stringMatching(/^ent_/) },
        { scope: 'write', entitlementId: expect.stringMatching(/^ent_/) },
      ])
      expect(
        JSON.parse(
          database.prepare(`SELECT entitlement_ids FROM external_token_lease WHERE id = 'lease-1'`).get()!
            .entitlement_ids as string,
        ),
      ).toHaveLength(2)
      for (const table of ['user_scope_grant', 'application_scope_grant', 'agent_access_grant']) {
        expect(
          database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table),
        ).toBeUndefined()
      }

      const insertInvalid = (values: string) =>
        database.exec(`
          INSERT INTO resource_scope_entitlement (
            id, user_id, application_id, agent_identity_id, organization_id, resource_server_id,
            connection_id, authorization_details, authorization_context_hash, scope, mode,
            granted_by_user_id, source_access_request_id, expires_at, ended_at, end_reason, created_at, updated_at
          ) VALUES (${values})
        `)
      expect(() =>
        insertInvalid(
          `'invalid-subject', NULL, NULL, NULL, NULL, 'resource-1', NULL, '[]', 'hash', 'x', 'persistent', 'admin', NULL, NULL, NULL, NULL, 1, 1`,
        ),
      ).toThrow()
      expect(() =>
        insertInvalid(
          `'invalid-two-subjects', 'user-1', 'app-1', NULL, NULL, 'resource-1', NULL, '[]', 'hash', 'x', 'persistent', 'admin', NULL, NULL, NULL, NULL, 1, 1`,
        ),
      ).toThrow()
      expect(() =>
        insertInvalid(
          `'invalid-lifetime', 'user-1', NULL, NULL, NULL, 'resource-1', NULL, '[]', 'other', 'x', 'until', 'admin', NULL, NULL, NULL, NULL, 1, 1`,
        ),
      ).toThrow()
      expect(() =>
        insertInvalid(
          `'invalid-end', 'user-1', NULL, NULL, NULL, 'resource-1', NULL, '[]', 'other', 'x', 'persistent', 'admin', NULL, NULL, 2, NULL, 1, 1`,
        ),
      ).toThrow()
      expect(() =>
        insertInvalid(
          `'duplicate-active', 'user-1', NULL, NULL, 'org-1', 'resource-1', NULL, '[]', '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945', 'read', 'persistent', 'admin', NULL, NULL, NULL, NULL, 1, 1`,
        ),
      ).toThrow()
    } finally {
      database.close()
    }
  })
})
