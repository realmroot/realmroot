import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const consentPolicyMigration = '20260820174500_sync_oauth_client_consent_policy.sql'

describe('OAuth client consent policy migration', () => {
  it('[spec: platform-onboarding/existing-d1-upgrade] synchronizes linked clients and preserves unrelated clients', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of migrationNames().filter((name) => name < consentPolicyMigration)) {
        database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      }
      database.exec(`
        INSERT INTO organization (id, slug, name)
        VALUES ('org-consent', 'consent-policy', 'Consent Policy');
        INSERT INTO oauth_client (id, client_id, skip_consent, redirect_uris)
        VALUES
          ('oauth-required', 'client-required', 1, '[]'),
          ('oauth-optional', 'client-optional', 0, '[]'),
          ('oauth-unrelated', 'client-unrelated', 0, '[]');
        INSERT INTO application (
          id, oauth_client_id, slug, name, owner_organization_id, consent_required
        ) VALUES
          ('application-required', 'client-required', 'required', 'Required', 'org-consent', 1),
          ('application-optional', 'client-optional', 'optional', 'Optional', 'org-consent', 0);
      `)

      database.exec(readFileSync(new URL(`../../migrations/${consentPolicyMigration}`, import.meta.url), 'utf8'))

      expect(
        database
          .prepare('SELECT client_id AS clientId, skip_consent AS skipConsent FROM oauth_client ORDER BY client_id')
          .all(),
      ).toEqual([
        { clientId: 'client-optional', skipConsent: 1 },
        { clientId: 'client-required', skipConsent: 0 },
        { clientId: 'client-unrelated', skipConsent: 0 },
      ])
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
