import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../migrations/20260818050000_atomic_exchange_refresh_rotation.sql', import.meta.url),
  'utf8',
)

describe('token exchange refresh rotation migration', () => {
  it('adds a nullable parent link and permits only one child per refresh token', () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec(`
        CREATE TABLE token_exchange_refresh_token (
          id text PRIMARY KEY NOT NULL,
          family_id text NOT NULL,
          token_hash text NOT NULL UNIQUE,
          client_id text NOT NULL,
          credential_id text NOT NULL,
          subject text NOT NULL,
          subject_token_issuer text NOT NULL,
          audience text NOT NULL,
          scopes text NOT NULL,
          claims text NOT NULL,
          expires_at integer NOT NULL,
          consumed_at integer,
          revoked_at integer,
          created_at integer NOT NULL
        );
      `)
      database.exec(migration)
      const insert = database.prepare(`
        INSERT INTO token_exchange_refresh_token
          (id, family_id, parent_id, token_hash, client_id, credential_id, subject,
           subject_token_issuer, audience, scopes, claims, expires_at, created_at)
        VALUES (?, 'family', ?, ?, 'client', 'credential', 'subject', 'issuer',
                'audience', '[]', '{}', 2000, 1000)
      `)
      insert.run('parent', null, 'parent-hash')
      insert.run('child-1', 'parent', 'child-1-hash')

      expect(() => insert.run('child-2', 'parent', 'child-2-hash')).toThrow('UNIQUE constraint failed')
      expect(database.prepare('SELECT count(*) AS count FROM token_exchange_refresh_token').get()).toEqual({ count: 2 })
    } finally {
      database.close()
    }
  })
})
