import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const migration = '20260810145702_permission_grant_actor.sql'

describe('Permission grant actor migration', () => {
  it('preserves existing User grantors and accepts Agent grantors', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of readdirSync(new URL('../../migrations', import.meta.url))
        .filter((name) => name.endsWith('.sql') && name < migration)
        .sort()) {
        database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      }

      database.exec(`
        INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
        VALUES ('admin', 'Admin', 'admin@example.com', 1, 1, 1), ('owner', 'Owner', 'owner@example.com', 1, 1, 1);
        INSERT INTO organization (id, slug, name, disabled, created_at, updated_at)
        VALUES ('org-1', 'org-1', 'Organization', 0, 1, 1);
        INSERT INTO api_resource (
          id, identifier, name, resource_url, owner_organization_id, enabled, created_at, updated_at,
          available_to_agents, authorization_details, visibility, access_mode
        ) VALUES ('resource-1', 'resource-1', 'Resource', 'https://api.example.com', 'org-1', 1, 1, 1, 1, '[]', 'public', 'realmroot');
        INSERT INTO agent_identity (id, issuer, subject, name, owner_user_id, status, created_at, updated_at)
        VALUES ('agent-admin', 'https://agent.example.com', 'agent-subject', 'Agent Admin', 'owner', 'active', 1, 1);
        INSERT INTO resource_scope_entitlement (
          id, user_id, resource_server_id, authorization_details, authorization_context_hash,
          scope, mode, granted_by_user_id, created_at, updated_at
        ) VALUES ('ent-existing', 'owner', 'resource-1', '[]', 'hash-existing', 'read', 'persistent', 'admin', 1, 1);
      `)

      database.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'))

      expect(
        database
          .prepare(
            `SELECT granted_by_user_id, granted_by_agent_identity_id FROM resource_scope_entitlement WHERE id = 'ent-existing'`,
          )
          .get(),
      ).toEqual({ granted_by_user_id: 'admin', granted_by_agent_identity_id: null })

      database.exec(`
        INSERT INTO resource_scope_entitlement (
          id, user_id, resource_server_id, authorization_details, authorization_context_hash,
          scope, mode, granted_by_agent_identity_id, created_at, updated_at
        ) VALUES ('ent-agent', 'owner', 'resource-1', '[]', 'hash-agent', 'write', 'persistent', 'agent-admin', 2, 2);
      `)
      expect(
        database
          .prepare(
            `SELECT granted_by_user_id, granted_by_agent_identity_id FROM resource_scope_entitlement WHERE id = 'ent-agent'`,
          )
          .get(),
      ).toEqual({ granted_by_user_id: null, granted_by_agent_identity_id: 'agent-admin' })

      expect(() =>
        database.exec(`
          INSERT INTO resource_scope_entitlement (
            id, user_id, resource_server_id, authorization_details, authorization_context_hash,
            scope, mode, created_at, updated_at
          ) VALUES ('ent-no-grantor', 'owner', 'resource-1', '[]', 'hash-none', 'delete', 'persistent', 3, 3);
        `),
      ).toThrow()
    } finally {
      database.close()
    }
  })
})
