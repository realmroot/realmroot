import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const lifecycleKeyMigration = '20260830200720_past_slayback.sql'

describe('Resource Server lifecycle key migration', () => {
  it('[spec: management-api/management-api-resource-soft-delete] preserves history and releases deleted business keys', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of migrationNames().filter((name) => name < lifecycleKeyMigration)) {
        database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      }
      database.exec(`
        INSERT INTO organization (id, slug, name)
        VALUES ('lifecycle-owner', 'lifecycle-owner', 'Lifecycle Owner');

        INSERT INTO api_resource (
          id, identifier, name, resource_url, owner_organization_id, deleted_at
        ) VALUES (
          'deleted-resource', 'reusable-resource', 'Deleted Resource',
          'https://reusable-resource.example.com/api', 'lifecycle-owner', 1
        )
      `)

      expect(() => insertReplacement(database, 'blocked-before-migration')).toThrow(/UNIQUE constraint failed/)

      database.exec(readFileSync(new URL(`../../migrations/${lifecycleKeyMigration}`, import.meta.url), 'utf8'))
      insertReplacement(database, 'replacement-resource')

      expect(
        database
          .prepare('SELECT id, deleted_at AS deletedAt FROM api_resource WHERE identifier = ? ORDER BY id')
          .all('reusable-resource'),
      ).toEqual([
        { id: 'deleted-resource', deletedAt: 1 },
        { id: 'replacement-resource', deletedAt: null },
      ])
      expect(() =>
        insertReplacement(database, 'active-identifier-conflict', 'https://different.example.com/api'),
      ).toThrow(/UNIQUE constraint failed/)
      expect(() =>
        insertReplacement(database, 'active-url-conflict', 'https://reusable-resource.example.com/api', 'different'),
      ).toThrow(/UNIQUE constraint failed/)
    } finally {
      database.close()
    }
  })
})

function insertReplacement(
  database: DatabaseSync,
  id: string,
  resourceUrl = 'https://reusable-resource.example.com/api',
  identifier = 'reusable-resource',
) {
  database
    .prepare(`
      INSERT INTO api_resource (id, identifier, name, resource_url, owner_organization_id)
      VALUES (?, ?, 'Replacement Resource', ?, 'lifecycle-owner')
    `)
    .run(id, identifier, resourceUrl)
}

function migrationNames() {
  return readdirSync(new URL('../../migrations', import.meta.url))
    .filter((name) => name.endsWith('.sql'))
    .sort()
}
