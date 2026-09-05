import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const migration = '20260905051211_noisy_echo.sql'
function legacyDatabase() {
  const db = new DatabaseSync(':memory:')
  for (const name of readdirSync(new URL('../../migrations', import.meta.url))
    .filter((name) => name.endsWith('.sql') && name < migration)
    .sort()) {
    db.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
  }
  return db
}
function migrate(db: DatabaseSync) {
  db.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'))
}
function group(db: DatabaseSync, key: string) {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(key) as { value: string }
  return JSON.parse(row.value)
}

describe('site settings migration', () => {
  it('[spec: admin-console/site-settings-migration] preserves configured values, nulls, extensions and old-Worker updates', () => {
    const db = legacyDatabase()
    try {
      db.prepare('INSERT INTO sign_in_experience (id,password_enabled,terms_uri,metadata) VALUES (?,?,?,?)').run(
        'default',
        0,
        null,
        JSON.stringify({
          copy: { appName: 'Existing site' },
          supportUri: 'https://example.com/help',
          customExtension: { retained: true },
          securityPolicy: { captcha: { secretKey: 'fixture-only-secret' }, password: { minLength: 14 } },
          developerPolicy: { organizationCreation: 'everyone' },
        }),
      )
      db.prepare('INSERT INTO account_center_setting (id,metadata) VALUES (?,?)').run(
        'account_center_default',
        JSON.stringify({ fieldPermissions: { displayNameEditable: false }, customExtension: 'kept' }),
      )
      db.exec(
        "INSERT INTO branding_setting (id,logo_url,primary_color) VALUES ('branding_default','https://example.com/logo.svg','#123456'); INSERT INTO email_service_config (id,from_email,enabled) VALUES ('email_default','hello@example.com',1)",
      )
      migrate(db)
      expect(group(db, 'sign_in')).toMatchObject({
        passwordEnabled: false,
        metadata: { customExtension: { retained: true } },
      })
      expect(group(db, 'sign_in').metadata).not.toHaveProperty('securityPolicy')
      expect(group(db, 'general')).toMatchObject({
        termsUri: null,
        supportUri: 'https://example.com/help',
        copy: { appName: 'Existing site' },
      })
      expect(group(db, 'security')).toMatchObject({ captcha: { secretKey: 'fixture-only-secret' } })
      expect(group(db, 'account_center')).toMatchObject({
        displayNameEditable: false,
        usernameEditable: true,
        metadata: { customExtension: 'kept' },
      })
      expect(group(db, 'branding')).toMatchObject({
        logoUrl: 'https://example.com/logo.svg',
        primaryColor: '#123456',
        faviconAssetId: null,
      })
      expect(group(db, 'email')).toMatchObject({ fromEmail: 'hello@example.com', enabled: true })
      db.exec("UPDATE sign_in_experience SET password_enabled=1 WHERE id='default'")
      expect(group(db, 'sign_in').passwordEnabled).toBe(true)
      db.exec(
        readFileSync(
          new URL('../../migrations/20260905054000_site_settings_developer_sync.sql', import.meta.url),
          'utf8',
        ),
      )
      db.exec(
        "INSERT INTO organization(id, slug, name) VALUES ('test-org', 'test-org', 'Test'); UPDATE organization SET metadata = '{\"realmroot\":{\"console\":{\"enabled\":true}}}' WHERE id = 'test-org'",
      )
      expect(group(db, 'developer').selectedOrganizationIds).toEqual(['test-org'])
      expect(db.prepare("SELECT revision FROM site_settings WHERE key='sign_in'").get()).toMatchObject({ revision: 2 })
      expect(db.prepare('SELECT count(*) AS count FROM sign_in_experience').get()).toMatchObject({ count: 1 })
    } finally {
      db.close()
    }
  })
  it('rejects ambiguous legacy singleton records before backfill', () => {
    const db = legacyDatabase()
    try {
      db.exec("INSERT INTO sign_in_experience(id) VALUES ('one'),('two')")
      expect(() => migrate(db)).toThrow(/CHECK/)
    } finally {
      db.close()
    }
  })
  it('supports a fresh database with no configured groups', () => {
    const db = legacyDatabase()
    try {
      migrate(db)
      expect(db.prepare('SELECT count(*) AS count FROM site_settings').get()).toMatchObject({ count: 0 })
    } finally {
      db.close()
    }
  })
})
