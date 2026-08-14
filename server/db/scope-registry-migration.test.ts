import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const scopeRegistryMigration = '20260813204636_remove_account_connection_scope_registry.sql'

describe('Resource scope registry migration', () => {
  it('[spec: platform-onboarding/existing-d1-upgrade] removes account connection metadata from every Resource', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of migrationNames().filter((name) => name < scopeRegistryMigration)) {
        database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      }
      database.exec(`
        INSERT INTO api_resource (
          id, identifier, name, resource_url, owner_organization_id, scope_registry
        ) VALUES
          (
            'stale-one', 'stale-one', 'Stale One', 'https://one.example.test',
            (SELECT id FROM organization LIMIT 1),
            '{"scopes":[],"accountConnection":{"mode":"brokered"}}'
          ),
          (
            'stale-two', 'stale-two', 'Stale Two', 'https://two.example.test',
            (SELECT id FROM organization LIMIT 1),
            '{"scopes":[],"accountConnection":{"mode":"brokered"}}'
          );
      `)

      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM api_resource WHERE json_type(scope_registry, '$.accountConnection') IS NOT NULL",
          )
          .get(),
      ).toEqual({ count: 2 })

      database.exec(readFileSync(new URL(`../../migrations/${scopeRegistryMigration}`, import.meta.url), 'utf8'))

      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM api_resource WHERE json_type(scope_registry, '$.accountConnection') IS NOT NULL",
          )
          .get(),
      ).toEqual({ count: 0 })
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
