import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import {
  apiPermission,
  apiScope,
  application,
  applicationClientMetadata,
  applicationClientSecret,
  applicationConsent,
  applicationRoleAssignment,
  identityProviderConnector,
  invitation,
  member,
  memberRoleAssignment,
  oauthClient,
  organization,
  passkey,
  rolePermission,
  session,
  twoFactor,
  user,
  userRoleAssignment,
} from './schema'

function columnNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).columns.map((column) => column.name)
}

function indexNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((index) => index.config.name)
}

function foreignKeyReferences(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference()

    return {
      columns: reference.columns.map((column) => column.name),
      foreignColumns: reference.foreignColumns.map((column) => column.name),
      foreignTable: getTableConfig(reference.foreignTable).name,
      onDelete: foreignKey.onDelete,
    }
  })
}

describe('database schema', () => {
  it('keeps Better Auth organization plugin tables compatible with teams disabled', () => {
    expect(columnNames(session)).toContain('active_organization_id')

    expect(getTableConfig(organization).name).toBe('organization')
    expect(columnNames(organization)).toEqual(
      expect.arrayContaining(['id', 'name', 'slug', 'logo', 'metadata', 'created_at']),
    )

    expect(getTableConfig(member).name).toBe('member')
    expect(columnNames(member)).toEqual(expect.arrayContaining(['organization_id', 'user_id', 'role', 'created_at']))

    expect(getTableConfig(invitation).name).toBe('invitation')
    expect(columnNames(invitation)).toEqual(
      expect.arrayContaining(['organization_id', 'email', 'role', 'status', 'expires_at', 'inviter_id', 'created_at']),
    )
  })

  it('anchors FlareAuth applications to Better Auth OAuth clients without changing provider tables', () => {
    expect(columnNames(oauthClient)).toEqual(
      expect.arrayContaining(['client_id', 'client_secret', 'disabled', 'skip_consent', 'redirect_uris']),
    )

    expect(indexNames(application)).toEqual(expect.arrayContaining(['application_oauthClientId_unique']))
    expect(foreignKeyReferences(application)).toContainEqual({
      columns: ['oauth_client_id'],
      foreignColumns: ['client_id'],
      foreignTable: 'oauth_client',
      onDelete: 'cascade',
    })

    expect(columnNames(oauthClient)).toEqual(expect.arrayContaining(['redirect_uris', 'grant_types', 'client_secret']))
    expect(indexNames(applicationClientSecret)).toEqual(
      expect.arrayContaining(['applicationClientSecret_applicationId_version_unique']),
    )
    expect(columnNames(applicationClientMetadata)).not.toEqual(
      expect.arrayContaining(['redirect_uris', 'grant_types', 'response_types', 'scopes', 'client_secret']),
    )
  })

  it('models resource authorization and subject-specific role assignments explicitly', () => {
    expect(indexNames(apiScope)).toEqual(expect.arrayContaining(['apiScope_resourceId_value_unique']))
    expect(indexNames(apiPermission)).toEqual(expect.arrayContaining(['apiPermission_resourceId_key_unique']))
    expect(indexNames(rolePermission)).toEqual(expect.arrayContaining(['rolePermission_roleId_permissionId_unique']))

    expect(indexNames(userRoleAssignment)).toEqual(expect.arrayContaining(['userRoleAssignment_roleId_userId_unique']))
    expect(indexNames(applicationRoleAssignment)).toEqual(
      expect.arrayContaining(['applicationRoleAssignment_roleId_applicationId_unique']),
    )
    expect(indexNames(memberRoleAssignment)).toEqual(
      expect.arrayContaining(['memberRoleAssignment_roleId_memberId_unique']),
    )
    expect(foreignKeyReferences(memberRoleAssignment)).toContainEqual({
      columns: ['member_id'],
      foreignColumns: ['id'],
      foreignTable: 'member',
      onDelete: 'cascade',
    })
  })

  it('serializes only flexible provider metadata and token claim fields as typed JSON', () => {
    expect(applicationClientMetadata.allowedEnvironments.mapToDriverValue(['production', 'preview'])).toBe(
      '["production","preview"]',
    )
    expect(applicationConsent.permissions.mapFromDriverValue('["read:users","write:users"]')).toEqual([
      'read:users',
      'write:users',
    ])
    expect(identityProviderConnector.attributeMapping.mapToDriverValue({ email: 'mail', name: 'displayName' })).toBe(
      '{"email":"mail","name":"displayName"}',
    )
    expect(indexNames(identityProviderConnector)).toEqual(
      expect.arrayContaining(['identityProviderConnector_providerId_unique']),
    )
  })

  it('stores account profile fields on the Better Auth user table', () => {
    expect(columnNames(user)).toEqual(expect.arrayContaining(['username', 'display_username', 'avatar_asset_id']))
  })

  it('keeps Better Auth security plugin tables compatible with the configured plugins', () => {
    expect(columnNames(user)).toContain('two_factor_enabled')

    expect(getTableConfig(twoFactor).name).toBe('two_factor')
    expect(columnNames(twoFactor)).toEqual(
      expect.arrayContaining(['id', 'secret', 'backup_codes', 'user_id', 'verified']),
    )
    expect(indexNames(twoFactor)).toEqual(expect.arrayContaining(['twoFactor_secret_idx', 'twoFactor_userId_idx']))
    expect(foreignKeyReferences(twoFactor)).toContainEqual({
      columns: ['user_id'],
      foreignColumns: ['id'],
      foreignTable: 'user',
      onDelete: 'cascade',
    })

    expect(getTableConfig(passkey).name).toBe('passkey')
    expect(columnNames(passkey)).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'public_key',
        'user_id',
        'credential_id',
        'counter',
        'device_type',
        'backed_up',
        'transports',
        'created_at',
        'aaguid',
      ]),
    )
    expect(indexNames(passkey)).toEqual(expect.arrayContaining(['passkey_userId_idx', 'passkey_credentialID_idx']))
    expect(foreignKeyReferences(passkey)).toContainEqual({
      columns: ['user_id'],
      foreignColumns: ['id'],
      foreignTable: 'user',
      onDelete: 'cascade',
    })
  })
})
