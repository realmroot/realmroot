import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const migration = '20260905054523_outstanding_typhoid_mary.sql'
function expandedDatabase() {
  const db = new DatabaseSync(':memory:')
  for (const name of readdirSync(new URL('../../migrations', import.meta.url))
    .filter((name) => name.endsWith('.sql') && name < migration)
    .sort()) {
    db.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
  }
  return db
}
function cleanup(db: DatabaseSync) {
  db.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'))
}

describe('site settings legacy cleanup', () => {
  it('[spec: admin-console/site-settings-cleanup] preserves current settings and revisions while removing only legacy storage', () => {
    const db = expandedDatabase()
    try {
      db.exec(
        "INSERT INTO sign_in_experience(id) VALUES ('default'); INSERT INTO email_service_config(id,from_email) VALUES ('email_default','hello@example.com'); INSERT INTO account_center_setting(id) VALUES ('account_center_default'); INSERT INTO branding_setting(id) VALUES ('branding_default')",
      )
      db.exec(
        `UPDATE site_settings SET value=json_set(value,'$.passwordEnabled',json('false')), revision=revision+1 WHERE key='sign_in'`,
      )
      db.prepare('INSERT INTO site_settings(key,value,revision,updated_at) VALUES (?,?,?,?)').run(
        'navigation',
        JSON.stringify({
          externalLinks: [{ id: 'wallet', label: 'Wallet', url: 'https://wallet.example.com', icon: 'wallet' }],
        }),
        4,
        1,
      )
      const before = db.prepare('SELECT * FROM site_settings ORDER BY key').all()
      cleanup(db)
      expect(db.prepare('SELECT * FROM site_settings ORDER BY key').all()).toEqual(before)
      for (const name of [
        'sign_in_experience',
        'email_service_config',
        'account_center_setting',
        'branding_setting',
        'deployment_setting',
      ]) {
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)).toBeUndefined()
      }
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'site_settings_%'").all(),
      ).toEqual([])
    } finally {
      db.close()
    }
  })
  it('refuses to remove an unmigrated populated source', () => {
    const db = expandedDatabase()
    try {
      db.exec("INSERT INTO sign_in_experience(id) VALUES ('default'); DELETE FROM site_settings WHERE key='security'")
      expect(() => cleanup(db)).toThrow(/CHECK/)
      expect(db.prepare('SELECT count(*) AS count FROM sign_in_experience').get()).toMatchObject({ count: 1 })
    } finally {
      db.close()
    }
  })
  it('cleans an unconfigured fresh installation', () => {
    const db = expandedDatabase()
    try {
      cleanup(db)
      expect(db.prepare('SELECT count(*) AS count FROM site_settings').get()).toMatchObject({ count: 0 })
    } finally {
      db.close()
    }
  })
})
