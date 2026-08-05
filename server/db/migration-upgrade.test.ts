import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const rolePermissionMigration = migration('20260801120140_natural_exodus.sql')
const roleCleanupMigration = migration('20260801121526_worthless_ultragirl.sql')
const ownershipMigration = migration('20260801123349_next_tattoo.sql')
const auditOwnershipMigration = migration('20260805014332_mute_patriot.sql')

describe('D1 migration upgrades', () => {
  it('preserves populated Application and Resource server dependents [spec: platform-onboarding/existing-d1-upgrade]', () => {
    const database = new DatabaseSync(':memory:')

    try {
      database.exec(legacySchema)
      database.exec(legacyData)
      applyMigration(database, rolePermissionMigration)
      applyMigration(database, roleCleanupMigration)
      applyMigration(database, ownershipMigration)

      expect(database.prepare('SELECT count(*) AS count FROM application_consent').get()).toEqual({ count: 1 })
      expect(database.prepare('SELECT count(*) AS count FROM agent_access_grant').get()).toEqual({ count: 1 })
      expect(database.prepare('SELECT count(*) AS count FROM role').get()).toEqual({ count: 1 })
      expect(
        database.prepare('SELECT resource_id, organization_id, application_id FROM role WHERE id = ?').get('role-1'),
      ).toEqual({ application_id: null, organization_id: null, resource_id: null })
      expect(database.prepare('SELECT role_id, resource_id, scope FROM role_permission').get()).toEqual({
        resource_id: 'resource-1',
        role_id: 'role-1',
        scope: 'items:read',
      })
      expect(database.prepare('SELECT role_id, subject_type, subject_id FROM role_assignment').get()).toEqual({
        role_id: 'role-1',
        subject_id: 'user-admin',
        subject_type: 'user',
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

  it('backfills recoverable audit owners and quarantines ambiguous Realmroot history', () => {
    const database = new DatabaseSync(':memory:')

    try {
      database.exec(auditLegacySchema)
      database.exec(auditLegacyData)
      applyMigration(database, auditOwnershipMigration)

      expect(
        database
          .prepare(
            "SELECT id, owner_user_id, owner_organization_id, json_extract(metadata, '$.ownerResolution') AS owner_resolution FROM agent_audit_event ORDER BY id",
          )
          .all(),
      ).toEqual([
        {
          id: 'account-authority',
          owner_user_id: 'user-account',
          owner_organization_id: null,
          owner_resolution: null,
        },
        {
          id: 'connection-owner',
          owner_user_id: 'user-account',
          owner_organization_id: null,
          owner_resolution: null,
        },
        {
          id: 'external-resource-owner',
          owner_user_id: null,
          owner_organization_id: 'org-resource',
          owner_resolution: null,
        },
        {
          id: 'identity-owner',
          owner_user_id: null,
          owner_organization_id: 'org-agent',
          owner_resolution: null,
        },
        {
          id: 'organization-authority',
          owner_user_id: null,
          owner_organization_id: 'org-authority',
          owner_resolution: null,
        },
        {
          id: 'realm-authority',
          owner_user_id: null,
          owner_organization_id: null,
          owner_resolution: null,
        },
        {
          id: 'unresolved-authority',
          owner_user_id: null,
          owner_organization_id: null,
          owner_resolution: 'legacy-authority-unresolved',
        },
      ])
      expect(() =>
        database
          .prepare(
            "INSERT INTO agent_audit_event (id, action, owner_user_id, owner_organization_id) VALUES ('invalid-insert', 'test', 'user-1', 'org-1')",
          )
          .run(),
      ).toThrow('agent_audit_event has multiple management owners')
      expect(() =>
        database
          .prepare(
            "UPDATE agent_audit_event SET owner_user_id = 'user-1', owner_organization_id = 'org-1' WHERE id = 'realm-authority'",
          )
          .run(),
      ).toThrow('agent_audit_event has multiple management owners')
      expect(() =>
        database.prepare("INSERT INTO agent_audit_event (id, action) VALUES ('realm-owned', 'test')").run(),
      ).not.toThrow()
    } finally {
      database.close()
    }
  })
})

const auditLegacySchema = `
  CREATE TABLE agent_identity (
    id TEXT PRIMARY KEY NOT NULL,
    owner_user_id TEXT,
    owner_organization_id TEXT
  );
  CREATE TABLE api_resource (
    id TEXT PRIMARY KEY NOT NULL,
    owner_organization_id TEXT NOT NULL
  );
  CREATE TABLE resource_account_connection (
    id TEXT PRIMARY KEY NOT NULL,
    owner_user_id TEXT,
    owner_organization_id TEXT
  );
  CREATE TABLE agent_access_grant (
    id TEXT PRIMARY KEY NOT NULL,
    authorization_details TEXT DEFAULT '[]' NOT NULL
  );
  CREATE TABLE agent_audit_event (
    id TEXT PRIMARY KEY NOT NULL,
    action TEXT NOT NULL,
    agent_identity_id TEXT,
    resource_id TEXT,
    resource_connection_id TEXT,
    access_grant_id TEXT,
    metadata TEXT
  );
`

const auditLegacyData = `
  INSERT INTO agent_identity (id, owner_organization_id) VALUES ('agent-org', 'org-agent');
  INSERT INTO api_resource (id, owner_organization_id) VALUES ('resource-external', 'org-resource');
  INSERT INTO api_resource (id, owner_organization_id) VALUES ('res_realmroot', 'org-platform');
  INSERT INTO resource_account_connection (id, owner_user_id) VALUES ('connection-account', 'user-account');
  INSERT INTO agent_access_grant (id, authorization_details) VALUES
    ('grant-account', '[{"type":"realmroot_authority","authority":"account","id":"user-account"}]'),
    ('grant-organization', '[{"type":"realmroot_authority","authority":"organization","id":"org-authority"}]'),
    ('grant-realm', '[{"type":"realmroot_authority","authority":"realm","id":"realm"}]');
  INSERT INTO agent_audit_event (
    id, action, agent_identity_id, resource_id, resource_connection_id, access_grant_id, metadata
  ) VALUES
    ('identity-owner', 'agent.retired', 'agent-org', NULL, NULL, NULL, NULL),
    ('connection-owner', 'api_resource.connection_updated', NULL, 'resource-external', 'connection-account', NULL, NULL),
    ('external-resource-owner', 'api_resource.access_requested', NULL, 'resource-external', NULL, NULL, NULL),
    ('account-authority', 'api_resource.token_issued', NULL, 'res_realmroot', NULL, 'grant-account', NULL),
    ('organization-authority', 'api_resource.token_issued', NULL, 'res_realmroot', NULL, 'grant-organization', NULL),
    ('realm-authority', 'api_resource.token_issued', NULL, 'res_realmroot', NULL, 'grant-realm', NULL),
    ('unresolved-authority', 'api_resource.access_requested', NULL, 'res_realmroot', NULL, NULL, '{"existing":true}');
`

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
