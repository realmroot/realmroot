import {
  account,
  accountCenterSetting,
  agent,
  agentCapabilityGrant,
  agentHost,
  apiPermission,
  apiResource,
  apiScope,
  application,
  applicationClientMetadata,
  applicationClientSecret,
  applicationConsent,
  applicationRoleAssignment,
  approvalRequest,
  brandingSetting,
  customDomain,
  deploymentSetting,
  deviceCode,
  emailServiceConfig,
  identityProviderConnector,
  invitation,
  jwks,
  member,
  memberRoleAssignment,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  organization,
  passkey,
  role,
  rolePermission,
  session,
  signInExperience,
  twoFactor,
  uploadedAsset,
  user,
  userRoleAssignment,
  verification,
  webhookDeliveryRequest,
  webhookEndpoint,
} from '@server/db/schema'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

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

describe('schema.test 1', () => {
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

  it('stores Better Auth JWT key metadata required by generated JWKs', () => {
    expect(columnNames(jwks)).toEqual(
      expect.arrayContaining(['id', 'public_key', 'private_key', 'alg', 'crv', 'created_at', 'expires_at']),
    )
  })

  it('stores Better Auth device authorization requests', () => {
    expect(getTableConfig(deviceCode).name).toBe('device_code')
    expect(columnNames(deviceCode)).toEqual(
      expect.arrayContaining([
        'id',
        'device_code',
        'user_code',
        'user_id',
        'expires_at',
        'status',
        'last_polled_at',
        'polling_interval',
        'client_id',
        'scope',
      ]),
    )
    expect(indexNames(deviceCode)).toEqual(
      expect.arrayContaining([
        'deviceCode_deviceCode_idx',
        'deviceCode_userCode_idx',
        'deviceCode_clientId_idx',
        'deviceCode_userId_idx',
        'deviceCode_expiresAt_idx',
      ]),
    )
  })

  it('keeps Better Auth AgentAuth plugin tables compatible with delegated mode', () => {
    expect(getTableConfig(agentHost).name).toBe('agent_host')
    expect(columnNames(agentHost)).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'user_id',
        'default_capabilities',
        'public_key',
        'kid',
        'jwks_url',
        'enrollment_token_hash',
        'enrollment_token_expires_at',
        'status',
        'activated_at',
        'expires_at',
        'last_used_at',
        'created_at',
        'updated_at',
      ]),
    )
    expect(indexNames(agentHost)).toEqual(
      expect.arrayContaining([
        'agentHost_userId_idx',
        'agentHost_kid_idx',
        'agentHost_enrollmentTokenHash_idx',
        'agentHost_status_idx',
      ]),
    )
    expect(foreignKeyReferences(agentHost)).toContainEqual({
      columns: ['user_id'],
      foreignColumns: ['id'],
      foreignTable: 'user',
      onDelete: 'cascade',
    })

    expect(getTableConfig(agent).name).toBe('agent')
    expect(columnNames(agent)).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'user_id',
        'host_id',
        'status',
        'mode',
        'public_key',
        'kid',
        'jwks_url',
        'last_used_at',
        'activated_at',
        'expires_at',
        'metadata',
        'created_at',
        'updated_at',
      ]),
    )
    expect(foreignKeyReferences(agent)).toContainEqual({
      columns: ['host_id'],
      foreignColumns: ['id'],
      foreignTable: 'agent_host',
      onDelete: 'cascade',
    })

    expect(getTableConfig(agentCapabilityGrant).name).toBe('agent_capability_grant')
    expect(columnNames(agentCapabilityGrant)).toEqual(
      expect.arrayContaining([
        'id',
        'agent_id',
        'capability',
        'denied_by',
        'granted_by',
        'expires_at',
        'created_at',
        'updated_at',
        'status',
        'reason',
        'constraints',
      ]),
    )
    expect(indexNames(agentCapabilityGrant)).toEqual(
      expect.arrayContaining([
        'agentCapabilityGrant_agentId_idx',
        'agentCapabilityGrant_capability_idx',
        'agentCapabilityGrant_grantedBy_idx',
        'agentCapabilityGrant_status_idx',
      ]),
    )
    expect(foreignKeyReferences(agentCapabilityGrant)).toEqual(
      expect.arrayContaining([
        {
          columns: ['agent_id'],
          foreignColumns: ['id'],
          foreignTable: 'agent',
          onDelete: 'cascade',
        },
        {
          columns: ['denied_by'],
          foreignColumns: ['id'],
          foreignTable: 'user',
          onDelete: 'cascade',
        },
        {
          columns: ['granted_by'],
          foreignColumns: ['id'],
          foreignTable: 'user',
          onDelete: 'cascade',
        },
      ]),
    )

    expect(getTableConfig(approvalRequest).name).toBe('approval_request')
    expect(columnNames(approvalRequest)).toEqual(
      expect.arrayContaining([
        'id',
        'method',
        'agent_id',
        'host_id',
        'user_id',
        'capabilities',
        'status',
        'user_code_hash',
        'login_hint',
        'binding_message',
        'client_notification_token',
        'client_notification_endpoint',
        'delivery_mode',
        'interval',
        'last_polled_at',
        'expires_at',
        'created_at',
        'updated_at',
      ]),
    )
    expect(foreignKeyReferences(approvalRequest)).toEqual(
      expect.arrayContaining([
        {
          columns: ['agent_id'],
          foreignColumns: ['id'],
          foreignTable: 'agent',
          onDelete: 'cascade',
        },
        {
          columns: ['host_id'],
          foreignColumns: ['id'],
          foreignTable: 'agent_host',
          onDelete: 'cascade',
        },
        {
          columns: ['user_id'],
          foreignColumns: ['id'],
          foreignTable: 'user',
          onDelete: 'cascade',
        },
      ]),
    )
  })
})

const _schemaTables = [
  user,
  session,
  account,
  verification,
  jwks,
  twoFactor,
  passkey,
  oauthClient,
  oauthRefreshToken,
  oauthAccessToken,
  oauthConsent,
  agentHost,
  agent,
  agentCapabilityGrant,
  approvalRequest,
  uploadedAsset,
  organization,
  member,
  invitation,
  apiResource,
  apiScope,
  apiPermission,
  role,
  rolePermission,
  userRoleAssignment,
  applicationRoleAssignment,
  memberRoleAssignment,
  application,
  applicationClientSecret,
  applicationClientMetadata,
  applicationConsent,
  identityProviderConnector,
  emailServiceConfig,
  signInExperience,
  brandingSetting,
  accountCenterSetting,
  deploymentSetting,
  customDomain,
  webhookEndpoint,
  webhookDeliveryRequest,
]

function _relationKeys(relationsObject: { config: (helpers: never) => Record<string, unknown> }) {
  return Object.keys(relationsObject.config(relationHelpers as never))
}

type RelationHelpers = {
  one: (table: unknown, config: unknown) => unknown
  many: (table: unknown) => unknown
}

const relationHelpers: RelationHelpers = {
  one: (table, config) => relationStub({ type: 'one', table, config }),
  many: (table) => relationStub({ type: 'many', table }),
}

function relationStub(value: unknown) {
  return {
    value,
    withFieldName: (fieldName: string) => ({ value, fieldName }),
  }
}
