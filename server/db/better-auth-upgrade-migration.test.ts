import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'

const migration = '20260922163336_better_auth_1_7.sql'

it('[spec: platform-onboarding/existing-d1-upgrade] preserves auth data and backfills Better Auth 1.7 policy fields', () => {
  const db = new DatabaseSync(':memory:')
  try {
    for (const name of readdirSync(new URL('../../migrations', import.meta.url))
      .filter((name) => name.endsWith('.sql') && name < migration)
      .sort()) {
      db.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
    }
    db.exec(`
      INSERT INTO organization (id, slug, name) VALUES ('org-upgrade', 'upgrade', 'Upgrade');
      INSERT INTO user (id, name, email) VALUES ('user-upgrade', 'Upgrade', 'upgrade@example.com');
      INSERT INTO account (id, account_id, provider_id, user_id) VALUES ('account-upgrade', 'subject', 'github', 'user-upgrade');
      INSERT INTO oauth_client (id, client_id, redirect_uris, type, scopes) VALUES ('client-row', 'client-upgrade', '[]', 'public_native', 'openid read write');
      INSERT INTO application (id, oauth_client_id, slug, name, owner_organization_id, resource_scopes)
      VALUES ('app-upgrade', 'client-upgrade', 'upgrade', 'Upgrade', 'org-upgrade', '[{"resourceServerId":"resource-1","scopes":["read","write"]},{"resourceServerId":"resource-2","scopes":["read"]}]');
      INSERT INTO device_code (id, device_code, user_code, expires_at, status, client_id)
      VALUES ('device-upgrade', 'device-code', 'USERCODE', 9999999999999, 'pending', 'client-upgrade');
      INSERT INTO team (id, name, organization_id) VALUES ('team-upgrade', 'upgrade', 'org-upgrade');
      INSERT INTO team_member (id, team_id, user_id) VALUES ('member-upgrade', 'team-upgrade', 'user-upgrade');
    `)
    db.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'))
    const client = db
      .prepare(
        'SELECT client_credentials_scopes AS scopes, application_type AS type FROM oauth_client WHERE client_id = ?',
      )
      .get('client-upgrade')!
    expect(JSON.parse(client.scopes as string)).toEqual(['read', 'write'])
    expect(client.type).toBe('native')
    expect(db.prepare('SELECT oauth_client_id FROM device_code').get()).toEqual({ oauth_client_id: 'client-upgrade' })
    expect(db.prepare('SELECT member_count FROM team').get()).toEqual({ member_count: 1 })
    expect(db.prepare('SELECT account_id, provider_id FROM account').get()).toEqual({
      account_id: 'subject',
      provider_id: 'github',
    })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  } finally {
    db.close()
  }
})
