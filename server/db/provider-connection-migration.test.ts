import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const providerConnectionMigration = '20260808175918_brokered_provider_connections.sql'
const preserveDisplayNameMigration = '20260816034000_preserve_provider_connection_display_name.sql'
const dropProviderCredentialIdentityMigration = '20260816050000_drop_provider_credential_identity.sql'
const appleAccountBackfillMigration = '20260817163500_backfill_apple_provider_connections.sql'
const providerConnectionLifecycleMigration = '20260817185000_provider_connection_before_account.sql'

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

  it('backfills Apple Provider Connections created before their Connector without overwriting conflicts', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of migrationNames().filter((name) => name < appleAccountBackfillMigration)) {
        database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      }
      database.exec(`
        INSERT INTO user (id, name, email) VALUES
          ('user-missing', 'Missing', 'missing@example.com'),
          ('user-matching', 'Matching', 'matching@example.com'),
          ('user-conflict', 'Conflict', 'conflict@example.com'),
          ('user-google', 'Google', 'google@example.com');
        INSERT INTO account (id, account_id, provider_id, user_id) VALUES
          ('account-missing', 'apple-subject-missing', 'apple', 'user-missing'),
          ('account-matching', 'apple-subject-matching', 'apple', 'user-matching'),
          ('account-conflict', 'apple-subject-account', 'apple', 'user-conflict'),
          ('account-google', 'google-subject', 'google', 'user-google');
        INSERT INTO identity_provider_connector (
          id, slug, provider_type, provider_id, display_name
        ) VALUES
          ('connector-apple', 'apple', 'social', 'apple', 'Apple'),
          ('connector-google', 'google', 'social', 'google', 'Google');
        INSERT INTO provider_connection (
          id, connector_id, owner_user_id, authentication_account_id,
          external_subject, display_name, status
        ) VALUES
          (
            'connection-matching', 'connector-apple', 'user-matching', NULL,
            'apple-subject-matching', 'Preserved Apple Name', 'revoked'
          ),
          (
            'connection-conflict', 'connector-apple', 'user-conflict', NULL,
            'different-apple-subject', 'Conflicting Apple Name', 'active'
          );
      `)

      const migration = readFileSync(
        new URL(`../../migrations/${appleAccountBackfillMigration}`, import.meta.url),
        'utf8',
      )
      database.exec(migration)
      const afterFirstRun = database
        .prepare(`
          SELECT id, owner_user_id, authentication_account_id, external_subject, display_name, status
          FROM provider_connection
          ORDER BY id
        `)
        .all()

      expect(afterFirstRun).toEqual([
        {
          authentication_account_id: null,
          display_name: 'Conflicting Apple Name',
          external_subject: 'different-apple-subject',
          id: 'connection-conflict',
          owner_user_id: 'user-conflict',
          status: 'active',
        },
        {
          authentication_account_id: 'account-matching',
          display_name: 'Preserved Apple Name',
          external_subject: 'apple-subject-matching',
          id: 'connection-matching',
          owner_user_id: 'user-matching',
          status: 'active',
        },
        {
          authentication_account_id: 'account-missing',
          display_name: 'apple-subject-missing',
          external_subject: 'apple-subject-missing',
          id: 'provconn_auth_account-missing',
          owner_user_id: 'user-missing',
          status: 'active',
        },
      ])

      database.exec(migration)
      expect(
        database
          .prepare(`
            SELECT id, owner_user_id, authentication_account_id, external_subject, display_name, status
            FROM provider_connection
            ORDER BY id
          `)
          .all(),
      ).toEqual(afterFirstRun)
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })

  it('[spec: account-center/provider-connection-social-sign-in] creates Provider Connections before authentication accounts and attaches accounts without replacing resource identity', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of migrationNames().filter((name) => name < providerConnectionLifecycleMigration)) {
        database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      }
      database.exec(
        readFileSync(new URL(`../../migrations/${providerConnectionLifecycleMigration}`, import.meta.url), 'utf8'),
      )
      database.exec(`
        INSERT INTO user (id, name, email) VALUES
          ('user-google', 'Google Person', 'google@example.com'),
          ('user-email', '', 'fallback@example.com'),
          ('user-resource', 'Realmroot Owner', 'owner@example.com'),
          ('user-rollback', 'Rollback Owner', 'rollback@example.com'),
          ('user-other', 'Other Owner', 'other@example.com');
        INSERT INTO identity_provider_connector (
          id, slug, provider_type, provider_id, display_name
        ) VALUES
          ('connector-google', 'google', 'social', 'google', 'Google'),
          ('connector-apple', 'apple', 'social', 'apple', 'Apple'),
          ('connector-github', 'github', 'social', 'github', 'GitHub');
        INSERT INTO provider_connection (
          id, connector_id, owner_user_id, external_subject, display_name
        ) VALUES
          ('connection-resource', 'connector-github', 'user-resource', 'github-subject', 'Resource Login'),
          ('connection-other', 'connector-apple', 'user-other', 'claimed-apple-subject', 'Other Apple Account');
        CREATE TABLE insertion_order (
          sequence integer PRIMARY KEY AUTOINCREMENT,
          entity text NOT NULL
        );
        CREATE TRIGGER record_provider_connection_insert
        AFTER INSERT ON provider_connection
        BEGIN
          INSERT INTO insertion_order (entity) VALUES ('provider_connection');
        END;
        CREATE TRIGGER record_account_insert
        AFTER INSERT ON account
        BEGIN
          INSERT INTO insertion_order (entity) VALUES ('account');
        END;
      `)

      database.exec(`
        INSERT INTO account (id, account_id, provider_id, user_id)
        VALUES ('account-google', 'google-subject', 'google', 'user-google')
      `)

      expect(database.prepare('SELECT entity FROM insertion_order ORDER BY sequence').all()).toEqual([
        { entity: 'provider_connection' },
        { entity: 'account' },
      ])
      expect(
        database
          .prepare(`
            SELECT authentication_account_id, external_subject, display_name
            FROM provider_connection
            WHERE owner_user_id = 'user-google'
          `)
          .get(),
      ).toEqual({
        authentication_account_id: 'account-google',
        display_name: 'Google Person',
        external_subject: 'google-subject',
      })

      database.exec(`
        INSERT INTO account (id, account_id, provider_id, user_id)
        VALUES ('account-apple', 'apple-subject', 'apple', 'user-email')
      `)
      expect(
        database
          .prepare(`
            SELECT authentication_account_id, external_subject, display_name
            FROM provider_connection
            WHERE owner_user_id = 'user-email'
          `)
          .get(),
      ).toEqual({
        authentication_account_id: 'account-apple',
        display_name: 'fallback@example.com',
        external_subject: 'apple-subject',
      })

      database.exec(`
        INSERT INTO account (id, account_id, provider_id, user_id)
        VALUES ('account-github', 'github-subject', 'github', 'user-resource')
      `)
      expect(
        database
          .prepare(`
            SELECT authentication_account_id, external_subject, display_name
            FROM provider_connection
            WHERE id = 'connection-resource'
          `)
          .get(),
      ).toEqual({
        authentication_account_id: 'account-github',
        display_name: 'Resource Login',
        external_subject: 'github-subject',
      })

      database.exec(`
        INSERT INTO account (id, account_id, provider_id, user_id)
        VALUES ('account-built-in', 'built-in-subject', 'built-in', 'user-google')
      `)
      expect(
        database
          .prepare("SELECT count(*) AS count FROM provider_connection WHERE external_subject = 'built-in-subject'")
          .get(),
      ).toEqual({ count: 0 })
      expect(() =>
        database.exec(`
          INSERT INTO account (id, account_id, provider_id, user_id)
          VALUES ('account-conflict', 'claimed-apple-subject', 'apple', 'user-google')
        `),
      ).toThrow('Provider account is already connected to another Realmroot account')
      expect(() =>
        database.exec(`
          INSERT INTO account (id, account_id, provider_id, user_id)
          VALUES ('account-mismatch', 'different-github-subject', 'github', 'user-resource')
        `),
      ).toThrow('provider connection external subject mismatch')
      database.exec(`
        CREATE TRIGGER force_account_failure
        AFTER INSERT ON account
        WHEN NEW.id = 'account-rollback'
        BEGIN
          SELECT RAISE(ABORT, 'forced account failure');
        END;
      `)
      expect(() =>
        database.exec(`
          INSERT INTO account (id, account_id, provider_id, user_id)
          VALUES ('account-rollback', 'rollback-subject', 'apple', 'user-rollback')
        `),
      ).toThrow('forced account failure')
      expect(
        database
          .prepare("SELECT count(*) AS count FROM provider_connection WHERE owner_user_id = 'user-rollback'")
          .get(),
      ).toEqual({ count: 0 })
      expect(() =>
        database.exec(`
          INSERT INTO account (id, account_id, provider_id, user_id)
          VALUES ('account-google-duplicate', 'google-subject', 'google', 'user-google')
        `),
      ).toThrow('provider connection already has an authentication account')

      const afterFirstRun = database
        .prepare(`
          SELECT id, authentication_account_id, external_subject, display_name, status
          FROM provider_connection
          ORDER BY id
        `)
        .all()
      database.exec(
        readFileSync(new URL(`../../migrations/${providerConnectionLifecycleMigration}`, import.meta.url), 'utf8'),
      )
      expect(
        database
          .prepare(`
            SELECT id, authentication_account_id, external_subject, display_name, status
            FROM provider_connection
            ORDER BY id
          `)
          .all(),
      ).toEqual(afterFirstRun)
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

function columnNames(database: DatabaseSync, table: string) {
  return database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => (column as { name: string }).name)
}
