import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const migration = '20260810153434_application_types.sql'

describe('Application type migration', () => {
  it('[spec: admin-console/admin-create-application] classifies existing clients and derives protocol configuration', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of readdirSync(new URL('../../migrations', import.meta.url))
        .filter((name) => name.endsWith('.sql') && name < migration)
        .sort()) {
        database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      }

      database.exec(`
        INSERT INTO organization (id, slug, name) VALUES ('org-1', 'org-1', 'Organization');
        INSERT INTO oauth_client (
          id, client_id, redirect_uris, grant_types, scopes, public, type, require_pkce,
          token_endpoint_auth_method
        ) VALUES
          ('oauth-web', 'client-web', '["https://web.example.com/callback"]',
            '["authorization_code","refresh_token","client_credentials"]', '["openid"]', 0,
            'confidential_web', 0, 'client_secret_basic'),
          ('oauth-spa', 'client-spa', '["https://spa.example.com/callback"]',
            '["authorization_code"]', '["openid"]', 1, 'public_spa', 1, 'none'),
          ('oauth-native', 'client-native', '["com.example.app:/callback"]',
            '["authorization_code"]', '["openid"]', 1, 'public_native', 1, 'none'),
          ('oauth-machine', 'client-machine', '["https://unused.example.com/callback"]',
            '["client_credentials"]', '["openid","payments:write"]', 0, 'confidential_web', 0,
            'client_secret_basic');
        INSERT INTO application (
          id, oauth_client_id, slug, name, owner_organization_id, oidc_scopes, resource_scopes
        ) VALUES
          ('app-web', 'client-web', 'web', 'Web', 'org-1', '["openid"]', '[]'),
          ('app-spa', 'client-spa', 'spa', 'SPA', 'org-1', '["openid"]', '[]'),
          ('app-native', 'client-native', 'native', 'Native', 'org-1', '["openid"]', '[]'),
          ('app-machine', 'client-machine', 'machine', 'Machine', 'org-1', '["openid"]',
            '[{"resourceServerId":"payments","scopes":["payments:write"]}]');
      `)

      database.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'))

      expect(
        database
          .prepare(
            `SELECT type, grant_types AS grantTypes, redirect_uris AS redirectUris, public, require_pkce AS requirePkce
             FROM oauth_client ORDER BY client_id`,
          )
          .all(),
      ).toEqual([
        {
          type: 'machine',
          grantTypes: '["client_credentials","urn:ietf:params:oauth:grant-type:token-exchange"]',
          redirectUris: '[]',
          public: 0,
          requirePkce: 0,
        },
        {
          type: 'public_native',
          grantTypes: '["authorization_code","refresh_token"]',
          redirectUris: '["com.example.app:/callback"]',
          public: 1,
          requirePkce: 1,
        },
        {
          type: 'public_spa',
          grantTypes: '["authorization_code","refresh_token"]',
          redirectUris: '["https://spa.example.com/callback"]',
          public: 1,
          requirePkce: 1,
        },
        {
          type: 'confidential_web',
          grantTypes: '["authorization_code","refresh_token"]',
          redirectUris: '["https://web.example.com/callback"]',
          public: 0,
          requirePkce: 0,
        },
      ])
      expect(database.prepare(`SELECT oidc_scopes FROM application WHERE id = 'app-machine'`).get()).toEqual({
        oidc_scopes: '[]',
      })
      expect(
        JSON.parse(
          String(database.prepare(`SELECT scopes FROM oauth_client WHERE id = 'oauth-machine'`).get()?.scopes),
        ),
      ).toEqual(['payments:write'])
    } finally {
      database.close()
    }
  })
})
