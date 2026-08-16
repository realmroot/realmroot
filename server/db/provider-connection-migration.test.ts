import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const providerConnectionMigration = '20260808175918_brokered_provider_connections.sql'
const preserveDisplayNameMigration = '20260816034000_preserve_provider_connection_display_name.sql'
const dropProviderCredentialIdentityMigration = '20260816050000_drop_provider_credential_identity.sql'

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

  it('[spec: account-center/provider-connection-sign-in-linking] restores and preserves Provider account labels', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of migrationNames().filter((name) => name < preserveDisplayNameMigration)) {
        database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      }
      database.exec("INSERT INTO user (id, name, email) VALUES ('user-1', 'Admin', 'admin@example.com')")
      database.exec(`
        INSERT INTO identity_provider_connector (
          id, slug, provider_type, provider_id, display_name, authentication_enabled,
          resource_authorization_enabled
        ) VALUES ('connector-github', 'github', 'social', 'github', 'GitHub', true, true)
      `)
      database.exec(`
        INSERT INTO api_resource (
          id, identifier, name, resource_url, authorization_model, connector_id, owner_organization_id
        ) VALUES (
          'resource-github', 'github', 'GitHub', 'https://api.github.com', 'external',
          'connector-github', (SELECT id FROM organization WHERE slug = 'realmroot')
        )
      `)
      database.exec(`
        INSERT INTO provider_connection (
          id, connector_id, owner_user_id, external_subject, display_name
        ) VALUES ('connection-github', 'connector-github', 'user-1', '17308208', 'saltbo')
      `)
      database.exec(`
        INSERT INTO provider_resource_authorization (
          id, provider_connection_id, resource_id
        ) VALUES ('authorization-github', 'connection-github', 'resource-github')
      `)
      database.exec(`
        INSERT INTO provider_credential (
          id, provider_resource_authorization_id, external_subject, display_name,
          encrypted_tokens, granted_scopes
        ) VALUES (
          'credential-github', 'authorization-github', '17308208', 'saltbo',
          'sealed-tokens', '["metadata:read"]'
        )
      `)
      database.exec(`
        INSERT INTO account (
          id, account_id, provider_id, user_id
        ) VALUES ('account-github', '17308208', 'github', 'user-1')
      `)

      expect(
        database
          .prepare('SELECT authentication_account_id, external_subject, display_name FROM provider_connection')
          .get(),
      ).toEqual({
        authentication_account_id: 'account-github',
        display_name: '17308208',
        external_subject: '17308208',
      })

      database.exec(readFileSync(new URL(`../../migrations/${preserveDisplayNameMigration}`, import.meta.url), 'utf8'))

      expect(
        database
          .prepare('SELECT authentication_account_id, external_subject, display_name FROM provider_connection')
          .get(),
      ).toEqual({
        authentication_account_id: 'account-github',
        display_name: 'saltbo',
        external_subject: '17308208',
      })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })

  it('removes duplicated Provider identity from credentials without changing credential data', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of migrationNames().filter((name) => name < dropProviderCredentialIdentityMigration)) {
        database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      }
      database.exec("INSERT INTO user (id, name, email) VALUES ('user-1', 'Admin', 'admin@example.com')")
      database.exec(`
        INSERT INTO identity_provider_connector (
          id, slug, provider_type, provider_id, display_name, resource_authorization_enabled
        ) VALUES ('connector-github', 'github', 'social', 'github', 'GitHub', true)
      `)
      database.exec(`
        INSERT INTO api_resource (
          id, identifier, name, resource_url, authorization_model, connector_id, owner_organization_id
        ) VALUES (
          'resource-github', 'github', 'GitHub', 'https://api.github.com', 'external',
          'connector-github', (SELECT id FROM organization WHERE slug = 'realmroot')
        )
      `)
      database.exec(`
        INSERT INTO provider_connection (
          id, connector_id, owner_user_id, external_subject, display_name
        ) VALUES ('connection-github', 'connector-github', 'user-1', '17308208', 'saltbo')
      `)
      database.exec(`
        INSERT INTO provider_resource_authorization (
          id, provider_connection_id, resource_id
        ) VALUES ('authorization-github', 'connection-github', 'resource-github')
      `)
      database.exec(`
        INSERT INTO provider_credential (
          id, provider_resource_authorization_id, external_subject, display_name,
          encrypted_tokens, granted_scopes, authorization_details, client_generation,
          credential_version, refresh_claim_id, refresh_claim_expires_at, status,
          credential_expires_at, revoked_at, created_at, updated_at
        ) VALUES (
          'credential-github', 'authorization-github', '17308208', 'saltbo',
          'sealed-tokens', '["metadata:read"]', '[{"type":"provider_installation"}]',
          2, 3, 'claim-1', 2000, 'active', 3000, NULL, 1000, 1500
        )
      `)

      database.exec(
        readFileSync(new URL(`../../migrations/${dropProviderCredentialIdentityMigration}`, import.meta.url), 'utf8'),
      )

      expect(columnNames(database, 'provider_credential')).not.toContain('external_subject')
      expect(columnNames(database, 'provider_credential')).not.toContain('display_name')
      expect(database.prepare('SELECT * FROM provider_credential').get()).toEqual({
        authorization_details: '[{"type":"provider_installation"}]',
        client_generation: 2,
        created_at: 1000,
        credential_expires_at: 3000,
        credential_version: 3,
        encrypted_tokens: 'sealed-tokens',
        granted_scopes: '["metadata:read"]',
        id: 'credential-github',
        provider_resource_authorization_id: 'authorization-github',
        refresh_claim_expires_at: 2000,
        refresh_claim_id: 'claim-1',
        revoked_at: null,
        status: 'active',
        updated_at: 1500,
      })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(() =>
        database.exec(`
          INSERT INTO provider_credential (
            id, provider_resource_authorization_id, encrypted_tokens, granted_scopes
          ) VALUES ('credential-duplicate', 'authorization-github', 'sealed-other', '[]')
        `),
      ).toThrow('UNIQUE constraint failed')
      database.exec("DELETE FROM provider_resource_authorization WHERE id = 'authorization-github'")
      expect(database.prepare('SELECT count(*) AS count FROM provider_credential').get()).toEqual({ count: 0 })
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
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => (column as { name: string }).name)
}
