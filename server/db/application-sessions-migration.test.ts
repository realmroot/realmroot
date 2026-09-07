import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'

it('migrates unidentified credentials without guessing ancestry and cascades lifecycle deletion', () => {
  const db = new DatabaseSync(':memory:')
  const migration = '20260907125736_application_sessions.sql'
  try {
    for (const name of readdirSync(new URL('../../migrations', import.meta.url))
      .filter((name) => name.endsWith('.sql') && name < migration)
      .sort()) {
      db.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
    }
    db.exec("INSERT INTO user(id, name, email) VALUES ('u', 'User', 'u@example.com')")
    db.exec("INSERT INTO oauth_client(id, client_id, redirect_uris) VALUES ('c', 'client', '[]')")
    const insert = db.prepare(
      'INSERT INTO oauth_refresh_token(id, token, client_id, user_id, created_at, expires_at, revoked, scopes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    insert.run('one', 'one-token', 'client', 'u', 1000, 9000, null, '["offline_access"]')
    insert.run('two', 'two-token', 'client', 'u', 2000, 9000, null, '["offline_access"]')
    insert.run('revoked', 'revoked-token', 'client', 'u', 3000, 9000, 4000, '["offline_access"]')
    db.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'))
    expect(db.prepare('SELECT id, legacy, revoked_at, user_agent FROM application_session ORDER BY id').all()).toEqual([
      { id: 'one', legacy: 1, revoked_at: null, user_agent: null },
      { id: 'two', legacy: 1, revoked_at: null, user_agent: null },
    ])
    expect(
      db.prepare('SELECT count(*) AS n FROM oauth_refresh_token WHERE application_session_id IS NOT NULL').get(),
    ).toMatchObject({ n: 2 })
    db.exec("PRAGMA foreign_keys = ON; DELETE FROM application_session WHERE id = 'one'")
    expect(db.prepare("SELECT id FROM oauth_refresh_token WHERE id = 'one'").get()).toBeUndefined()
    expect(db.prepare("SELECT revoked FROM oauth_refresh_token WHERE id = 'revoked'").get()).toEqual({ revoked: 4000 })
    db.exec('DELETE FROM user')
    expect(db.prepare('SELECT count(*) AS n FROM application_session').get()).toMatchObject({ n: 0 })
    expect(
      db.prepare('SELECT count(*) AS n FROM oauth_refresh_token WHERE application_session_id IS NOT NULL').get(),
    ).toMatchObject({ n: 0 })
  } finally {
    db.close()
  }
})
