import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const providerConnectionMigration = '20260808175918_brokered_provider_connections.sql'

describe('Provider Connection migration', () => {
  it('[spec: platform-onboarding/existing-d1-upgrade] preserves one provider subject and removes incompatible resource authority', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of migrationNames().filter((name) => name < providerConnectionMigration)) {
        database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      }
      database.exec(`
        INSERT INTO user (id, name, email) VALUES ('user-1', 'User', 'user@example.com');
        INSERT INTO identity_provider_connector (
          id, slug, provider_type, provider_id, display_name
        ) VALUES ('connector-1', 'provider', 'social', 'provider', 'Provider');
        INSERT INTO api_resource (
          id, identifier, name, resource_url, connector_id, owner_organization_id
        ) VALUES
          ('resource-1', 'provider-one', 'Provider One', 'https://adapter.example.com/one', 'connector-1', 'org_platform'),
          ('resource-2', 'provider-two', 'Provider Two', 'https://adapter.example.com/two', 'connector-1', 'org_platform');
        INSERT INTO account (id, account_id, provider_id, user_id) VALUES
          ('account-1', 'subject-login', 'provider', 'user-1');
        INSERT INTO resource_account_connection (
          id, resource_id, owner_user_id, external_subject, display_name,
          encrypted_tokens, granted_scopes
        ) VALUES
          ('authorization-matching', 'resource-1', 'user-1', 'subject-login', 'Login Subject', 'sealed-1', '["provider:read"]'),
          ('authorization-mismatch', 'resource-2', 'user-1', 'subject-other', 'Other Subject', 'sealed-2', '["provider:read"]');
        INSERT INTO agent_identity (id, issuer, subject, name, owner_user_id, created_at, updated_at)
        VALUES ('agent-1', 'https://issuer.example.test', 'agent-1', 'Agent', 'user-1', 1, 1);
        INSERT INTO agent_access_grant (
          id, resource_id, connection_id, agent_identity_id, scopes, mode, granted_by_user_id
        ) VALUES (
          'grant-1', 'resource-1', 'authorization-matching', 'agent-1', '["provider:read"]', 'external', 'user-1'
        );
      `)

      database.exec('PRAGMA foreign_keys = ON')
      database.exec(readFileSync(new URL(`../../migrations/${providerConnectionMigration}`, import.meta.url), 'utf8'))

      expect(
        database
          .prepare(
            'SELECT connector_id, owner_user_id, authentication_account_id, external_subject FROM provider_connection',
          )
          .all(),
      ).toEqual([
        {
          authentication_account_id: 'account-1',
          connector_id: 'connector-1',
          external_subject: 'subject-login',
          owner_user_id: 'user-1',
        },
      ])
      expect(database.prepare('SELECT id FROM provider_resource_authorization').all()).toEqual([
        { id: 'authorization-matching' },
      ])
      expect(database.prepare("SELECT connection_id FROM agent_access_grant WHERE id = 'grant-1'").get()).toEqual({
        connection_id: 'authorization-matching',
      })
      expect(() =>
        database.exec(
          "INSERT INTO account (id, account_id, provider_id, user_id) VALUES ('account-2', 'subject-other', 'provider', 'user-1')",
        ),
      ).toThrow('provider connection external subject mismatch')
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
