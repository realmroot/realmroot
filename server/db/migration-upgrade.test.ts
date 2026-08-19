import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const rolePermissionMigration = migration('20260801120140_natural_exodus.sql')
const roleCleanupMigration = migration('20260801121526_worthless_ultragirl.sql')
const ownershipMigration = migration('20260801123349_next_tattoo.sql')
const organizationRbacMigration = migration('20260805160616_round_wither.sql')
const rfc9728ScopeRegistryMigration = migration('20260806214840_rfc9728_scope_registry.sql')
const platformAuthorityMigration = migration('20260807000000_platform_authority.sql')
const groupAwareOidcMigration = migration('20260819015324_damp_exiles.sql')

describe('D1 migration upgrades', () => {
  it('migrates Applications and installs Better Auth Team storage [spec: platform-onboarding/existing-d1-upgrade]', () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE organization (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE oauth_client (client_id TEXT PRIMARY KEY NOT NULL, type TEXT);
        CREATE TABLE application (
          id TEXT PRIMARY KEY NOT NULL,
          oauth_client_id TEXT NOT NULL,
          oidc_scopes TEXT NOT NULL
        );
        CREATE TABLE session (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE invitation (id TEXT PRIMARY KEY NOT NULL);
        INSERT INTO organization VALUES ('org-1'), ('org-2');
        INSERT INTO user VALUES ('user-1');
        INSERT INTO oauth_client VALUES ('web-client', 'confidential_web'), ('machine-client', 'machine');
        INSERT INTO application VALUES
          ('web-app', 'web-client', '["openid","profile","email"]'),
          ('machine-app', 'machine-client', '["offline_access"]');
      `)

      applyMigration(database, groupAwareOidcMigration)

      expect(database.prepare('SELECT id, visibility, oidc_scopes FROM application ORDER BY id').all()).toEqual([
        { id: 'machine-app', visibility: 'public', oidc_scopes: '["offline_access"]' },
        { id: 'web-app', visibility: 'public', oidc_scopes: '["openid","profile","email","groups"]' },
      ])
      database.exec(`
        INSERT INTO oauth_client VALUES ('new-client', 'public_native');
        INSERT INTO application (id, oauth_client_id, oidc_scopes) VALUES ('new-app', 'new-client', '["openid"]');
      `)
      expect(database.prepare("SELECT visibility FROM application WHERE id = 'new-app'").get()).toEqual({
        visibility: 'private',
      })
      database.exec(`
        INSERT INTO team (id, name, organization_id) VALUES ('team-1', 'platform-admins', 'org-1');
        INSERT INTO team (id, name, organization_id) VALUES ('team-2', 'platform-admins', 'org-2');
        INSERT INTO team_member (id, team_id, user_id) VALUES ('tm-1', 'team-1', 'user-1');
      `)
      expect(() =>
        database.exec("INSERT INTO team (id, name, organization_id) VALUES ('team-3', 'platform-admins', 'org-1')"),
      ).toThrow()
      expect(() =>
        database.exec("INSERT INTO team_member (id, team_id, user_id) VALUES ('tm-2', 'team-1', 'user-1')"),
      ).toThrow()
      expect(database.prepare("SELECT count(*) AS count FROM team WHERE name = 'platform-admins'").get()).toEqual({
        count: 2,
      })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })

  it('preserves populated Application and Resource server dependents [spec: platform-onboarding/existing-d1-upgrade]', () => {
    const database = new DatabaseSync(':memory:')

    try {
      database.exec(legacySchema)
      database.exec(legacyData)
      applyMigration(database, rolePermissionMigration)
      applyMigration(database, roleCleanupMigration)
      applyMigration(database, ownershipMigration)
      applyMigration(database, organizationRbacMigration)

      expect(database.prepare('SELECT count(*) AS count FROM application_consent').get()).toEqual({ count: 1 })
      expect(database.prepare('SELECT count(*) AS count FROM agent_access_grant').get()).toEqual({ count: 1 })
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'role'").get(),
      ).toBeUndefined()
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'role_permission'").get(),
      ).toBeUndefined()
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'role_assignment'").get(),
      ).toBeUndefined()
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'organization_role'").get(),
      ).toEqual({ name: 'organization_role' })
      expect(
        database.prepare('SELECT organization_id, user_id, role FROM member WHERE id = ?').get('member-1'),
      ).toEqual({
        organization_id: 'org-1',
        role: 'owner,developer',
        user_id: 'user-admin',
      })
      expect(
        database
          .prepare('SELECT owner_organization_id, owner_user_id, audience_mode FROM application WHERE id = ?')
          .get('application-1'),
      ).toEqual({
        audience_mode: 'realm',
        owner_organization_id: 'org_platform',
        owner_user_id: null,
      })
      expect(
        database
          .prepare(
            'SELECT owner_organization_id, access_eligibility_mode, available_to_agents FROM api_resource WHERE id = ?',
          )
          .get('resource-1'),
      ).toEqual({
        access_eligibility_mode: 'realm',
        available_to_agents: 1,
        owner_organization_id: 'org_platform',
      })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })

  it('invalidates legacy non-built-in registries [spec: platform-onboarding/existing-d1-upgrade]', () => {
    const database = new DatabaseSync(':memory:')

    try {
      database.exec(`
        CREATE TABLE api_resource (
          id TEXT PRIMARY KEY NOT NULL,
          scope_registry TEXT
        );
        INSERT INTO api_resource (id, scope_registry) VALUES
          ('res_realmroot', '{"discovery":{"sourceUrl":"https://auth.example/api/openapi.json","syncedAt":"2026-08-01T00:00:00.000Z"},"scopes":[{"value":"applications:read","grantMode":"assigned"}]}'),
          ('resource-1', '{"discovery":{"sourceUrl":"https://api.example/openapi.json","syncedAt":"2026-08-01T00:00:00.000Z"},"scopes":[{"value":"items:read","grantMode":"automatic"}]}'),
          ('resource-2', NULL);
      `)

      applyMigration(database, rfc9728ScopeRegistryMigration)

      expect(database.prepare('SELECT id, scope_registry FROM api_resource ORDER BY id').all()).toEqual([
        {
          id: 'res_realmroot',
          scope_registry:
            '{"discovery":{"sourceUrl":"https://auth.example/api/openapi.json","syncedAt":"2026-08-01T00:00:00.000Z"},"scopes":[{"value":"applications:read","grantMode":"assigned"}]}',
        },
        {
          id: 'resource-1',
          scope_registry: null,
        },
        { id: 'resource-2', scope_registry: null },
      ])
    } finally {
      database.close()
    }
  })

  it('preserves legacy administrator authority for existing and new platform members', () => {
    const database = new DatabaseSync(':memory:')

    try {
      database.exec(`
        CREATE TABLE organization (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL, role TEXT);
        CREATE TABLE member (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE api_resource (
          id TEXT PRIMARY KEY NOT NULL,
          connector_id TEXT,
          owner_organization_id TEXT NOT NULL
        );
        INSERT INTO organization (id) VALUES ('org_platform');
        INSERT INTO user (id, role) VALUES
          ('existing-admin', 'user,admin'),
          ('new-admin', 'admin'),
          ('ordinary-user', 'user');
        INSERT INTO member (id, organization_id, user_id, role, created_at, updated_at) VALUES
          ('existing-member', 'org_platform', 'existing-admin', 'developer', 1, 1),
          ('ordinary-member', 'org_platform', 'ordinary-user', 'member', 1, 1);
      `)

      applyMigration(database, platformAuthorityMigration)

      expect(
        database
          .prepare("SELECT user_id, role FROM member WHERE organization_id = 'org_platform' ORDER BY user_id")
          .all(),
      ).toEqual([
        { role: 'developer,owner', user_id: 'existing-admin' },
        { role: 'owner', user_id: 'new-admin' },
        { role: 'member', user_id: 'ordinary-user' },
      ])
    } finally {
      database.close()
    }
  })
})

const legacySchema = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE organization (
    id TEXT PRIMARY KEY NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    metadata TEXT
  );
  CREATE TABLE user (
    id TEXT PRIMARY KEY NOT NULL,
    role TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE member (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    role TEXT NOT NULL
  );
  CREATE TABLE oauth_client (client_id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE uploaded_asset (id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE application (
    id TEXT PRIMARY KEY NOT NULL,
    oauth_client_id TEXT NOT NULL REFERENCES oauth_client(client_id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    homepage_url TEXT,
    logo_asset_id TEXT REFERENCES uploaded_asset(id) ON DELETE SET NULL,
    owner_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
    owner_organization_id TEXT REFERENCES organization(id) ON DELETE SET NULL,
    first_party INTEGER DEFAULT false NOT NULL,
    trusted INTEGER DEFAULT false NOT NULL,
    disabled INTEGER DEFAULT false NOT NULL,
    disabled_reason TEXT,
    access_token_ttl_seconds INTEGER,
    refresh_token_ttl_seconds INTEGER,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX application_ownerOrganizationId_idx ON application(owner_organization_id);
  CREATE TABLE identity_provider_connector (id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE api_resource (
    id TEXT PRIMARY KEY NOT NULL,
    identifier TEXT NOT NULL,
    name TEXT NOT NULL,
    resource_url TEXT NOT NULL,
    authorization_mode TEXT DEFAULT 'native' NOT NULL,
    connector_id TEXT REFERENCES identity_provider_connector(id) ON DELETE RESTRICT,
    description TEXT,
    enabled INTEGER DEFAULT true NOT NULL,
    archived_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE application_consent (
    id TEXT PRIMARY KEY NOT NULL,
    application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE
  );
  CREATE TABLE agent_access_grant (
    id TEXT PRIMARY KEY NOT NULL,
    resource_id TEXT NOT NULL REFERENCES api_resource(id) ON DELETE RESTRICT
  );
  CREATE TABLE agent_identity (id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE role (
    id TEXT PRIMARY KEY NOT NULL,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    resource_id TEXT REFERENCES api_resource(id) ON DELETE CASCADE,
    organization_id TEXT REFERENCES organization(id) ON DELETE CASCADE,
    application_id TEXT REFERENCES application(id) ON DELETE CASCADE,
    system INTEGER DEFAULT false NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX role_key_idx ON role(key);
  CREATE INDEX role_resourceId_idx ON role(resource_id);
  CREATE INDEX role_organizationId_idx ON role(organization_id);
  CREATE INDEX role_applicationId_idx ON role(application_id);
  CREATE TABLE role_scope (
    role_id TEXT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE user_role_assignment (
    id TEXT PRIMARY KEY NOT NULL,
    role_id TEXT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    assigned_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE application_role_assignment (
    id TEXT PRIMARY KEY NOT NULL,
    role_id TEXT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
    assigned_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE member_role_assignment (
    id TEXT PRIMARY KEY NOT NULL,
    role_id TEXT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    assigned_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE agent_role_assignment (
    id TEXT PRIMARY KEY NOT NULL,
    role_id TEXT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    agent_identity_id TEXT NOT NULL REFERENCES agent_identity(id) ON DELETE CASCADE,
    assigned_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
  );
`

const legacyData = `
  INSERT INTO user (id, role, created_at) VALUES ('user-admin', 'admin', 1);
  INSERT INTO organization (id, slug, name) VALUES ('org-1', 'acme', 'Acme');
  INSERT INTO member (id, organization_id, user_id, role) VALUES ('member-1', 'org-1', 'user-admin', 'owner,developer');
  INSERT INTO oauth_client (client_id) VALUES ('client-1');
  INSERT INTO application (
    id, oauth_client_id, slug, name, owner_user_id, created_at, updated_at
  ) VALUES ('application-1', 'client-1', 'application-1', 'Application 1', 'user-admin', 1, 1);
  INSERT INTO api_resource (
    id, identifier, name, resource_url, created_at, updated_at
  ) VALUES ('resource-1', 'resource-1', 'Resource 1', 'https://api.example.test', 1, 1);
  INSERT INTO application_consent (id, application_id) VALUES ('consent-1', 'application-1');
  INSERT INTO agent_access_grant (id, resource_id) VALUES ('grant-1', 'resource-1');
  INSERT INTO role (
    id, key, name, resource_id, created_at, updated_at
  ) VALUES ('role-1', 'items.reader', 'Items reader', 'resource-1', 1, 1);
  INSERT INTO role_scope (role_id, scope, created_at) VALUES ('role-1', 'items:read', 1);
  INSERT INTO user_role_assignment (
    id, role_id, user_id, assigned_by_user_id, created_at
  ) VALUES ('assignment-1', 'role-1', 'user-admin', 'user-admin', 1);
`

function migration(name: string) {
  return readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8')
}

function applyMigration(database: DatabaseSync, sql: string) {
  database.exec('PRAGMA foreign_keys = ON; BEGIN;')
  database.exec(sql)
  database.exec('COMMIT;')
}
