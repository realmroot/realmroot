import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const migration = '20260812001253_agent_username.sql'

describe('Agent username migration', () => {
  it('[spec: agent-identity/agent-identity-enrollment] requires an explicit immutable username without deriving one', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of readdirSync(new URL('../../migrations', import.meta.url))
        .filter((name) => name.endsWith('.sql') && name < migration)
        .sort()) {
        database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      }

      database.exec(`
        INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
        VALUES ('owner', 'Owner', 'owner@example.com', 1, 1, 1);
        INSERT INTO agent_identity (id, issuer, subject, name, owner_user_id, status, created_at, updated_at)
        VALUES ('legacy-agent', 'https://id.realmroot.dev/api/auth', 'subject-1', 'Build Agent', 'owner', 'active', 1, 1);
      `)

      database.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'))

      expect(database.prepare('SELECT username, runtime FROM agent_identity').get()).toEqual({
        username: null,
        runtime: null,
      })
      database.exec("UPDATE agent_identity SET username = 'build_agent', runtime = 'codex' WHERE id = 'legacy-agent'")
      expect(database.prepare('SELECT username, runtime FROM agent_identity').get()).toEqual({
        username: 'build_agent',
        runtime: 'codex',
      })
      expect(() =>
        database.exec("UPDATE agent_identity SET username = 'renamed-agent' WHERE id = 'legacy-agent'"),
      ).toThrow(/immutable/)
      expect(() =>
        database.exec(`
          INSERT INTO agent_identity (id, issuer, subject, name, owner_user_id, status, created_at, updated_at)
          VALUES ('identity-2', 'https://id.realmroot.dev/api/auth', 'subject-2', 'No Username', 'owner', 'active', 1, 1)
        `),
      ).toThrow(/invalid/)
    } finally {
      database.close()
    }
  })
})
