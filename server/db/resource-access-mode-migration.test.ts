import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const accessModeMigration = '20260808205043_talented_the_call.sql'

describe('Resource Server access mode migration', () => {
  it('[spec: platform-onboarding/existing-d1-upgrade] backfills explicit access modes and enforces Provider identity ownership', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of migrationNames().filter((name) => name < accessModeMigration)) {
        database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      }
      database.exec(`
        INSERT INTO user (id, name, email) VALUES
          ('user-1', 'One', 'one@example.com'),
          ('user-2', 'Two', 'two@example.com');
        INSERT INTO identity_provider_connector (
          id, slug, provider_type, provider_id, display_name
        ) VALUES ('connector-1', 'provider', 'generic_oauth', 'provider', 'Provider');
        INSERT INTO api_resource (
          id, identifier, name, resource_url, connector_id, owner_organization_id, scope_registry
        ) VALUES
          ('native', 'native', 'Native', 'https://native.example.com', NULL, 'org_platform', NULL),
          ('oauth', 'oauth', 'OAuth', 'https://oauth.example.com', 'connector-1', 'org_platform', NULL),
          ('brokered', 'brokered', 'Brokered', 'https://brokered.example.com', 'connector-1', 'org_platform',
            '{"accountConnection":{"mode":"brokered","authorizationEndpoint":"https://brokered.example.com/authorizations","tokenEndpoint":"https://brokered.example.com/credentials"}}');
        INSERT INTO account (id, account_id, provider_id, user_id) VALUES
          ('account-1', 'subject-1', 'provider', 'user-1');
      `)

      database.exec(readFileSync(new URL(`../../migrations/${accessModeMigration}`, import.meta.url), 'utf8'))

      expect(database.prepare('SELECT id, access_mode AS accessMode FROM api_resource ORDER BY id').all()).toEqual([
        { id: 'brokered', accessMode: 'brokered' },
        { id: 'native', accessMode: 'realmroot' },
        { id: 'oauth', accessMode: 'external_oauth' },
      ])
      expect(() =>
        database.exec(
          "INSERT INTO account (id, account_id, provider_id, user_id) VALUES ('account-2', 'subject-1', 'provider', 'user-2')",
        ),
      ).toThrow(/UNIQUE constraint failed/)
      expect(() =>
        database.exec(`
          INSERT INTO provider_connection (
            id, connector_id, owner_user_id, external_subject, display_name, status
          ) VALUES ('duplicate', 'connector-1', 'user-2', 'subject-1', 'Subject', 'active')
        `),
      ).toThrow(/UNIQUE constraint failed/)
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
