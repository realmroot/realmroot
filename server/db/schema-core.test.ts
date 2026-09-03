import {
  account,
  accountCenterSetting,
  agent,
  agentAccessRequest,
  agentApplicationCreation,
  agentAuditEvent,
  agentCapabilityGrant,
  agentDpopJti,
  agentEnrollmentIntent,
  agentHost,
  agentIdentity,
  agentIdentityBinding,
  apiResource,
  application,
  applicationClientMetadata,
  applicationClientSecret,
  applicationConsent,
  approvalRequest,
  brandingSetting,
  customDomain,
  deploymentSetting,
  deviceCode,
  emailServiceConfig,
  externalTokenLease,
  identityProviderConnector,
  invitation,
  jwks,
  member,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  organization,
  organizationRole,
  passkey,
  providerResourceAuthorization,
  resourceConnectionIntent,
  resourceScopeEntitlement,
  session,
  signInExperience,
  twoFactor,
  uploadedAsset,
  user,
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
      expect.arrayContaining([
        'organization_id',
        'email',
        'role',
        'status',
        'expires_at',
        'inviter_id',
        'team_id',
        'created_at',
      ]),
    )
    expect(foreignKeyReferences(invitation).map((reference) => reference.foreignTable)).not.toContain('team')
  })

  it('anchors Realmroot applications to Better Auth OAuth clients without changing provider tables', () => {
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

    expect(columnNames(oauthClient)).toEqual(
      expect.arrayContaining(['redirect_uris', 'grant_types', 'response_types', 'client_secret']),
    )
    expect(indexNames(applicationClientSecret)).toEqual(
      expect.arrayContaining(['applicationClientSecret_applicationId_version_unique']),
    )
    expect(columnNames(applicationClientMetadata)).not.toEqual(
      expect.arrayContaining(['redirect_uris', 'grant_types', 'response_types', 'scopes', 'client_secret']),
    )
  })

  it('models Better Auth dynamic Roles inside one Organization', () => {
    expect(indexNames(organizationRole)).toEqual(
      expect.arrayContaining(['organizationRole_organizationId_role_unique', 'organizationRole_organizationId_idx']),
    )
    expect(foreignKeyReferences(organizationRole)).toContainEqual({
      columns: ['organization_id'],
      foreignColumns: ['id'],
      foreignTable: 'organization',
      onDelete: 'cascade',
    })
  })

  it('serializes only flexible provider metadata and token claim fields as typed JSON', () => {
    expect(applicationClientMetadata.allowedEnvironments.mapToDriverValue(['production', 'preview'])).toBe(
      '["production","preview"]',
    )
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
      expect.arrayContaining([
        'id',
        'secret',
        'backup_codes',
        'user_id',
        'verified',
        'failed_verification_count',
        'locked_until',
      ]),
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

  it('models stable Agent identities without changing AgentAuth host records', () => {
    expect(columnNames(agentHost)).not.toContain('agent_identity_id')
    expect(indexNames(agentIdentity)).toEqual(
      expect.arrayContaining(['agentIdentity_issuer_subject_unique', 'agentIdentity_ownerUserId_idx']),
    )
    expect(indexNames(agentIdentityBinding)).toContain('agentIdentityBinding_protocolAgentId_unique')
    expect(indexNames(agentApplicationCreation)).toEqual([
      'agentApplicationCreation_applicationActorKey_unique',
      'agentApplicationCreation_agentIdentityId_unique',
    ])
    expect(foreignKeyReferences(agentApplicationCreation)).toEqual([
      {
        columns: ['actor_user_id'],
        foreignColumns: ['id'],
        foreignTable: 'user',
        onDelete: 'restrict',
      },
      {
        columns: ['agent_identity_id'],
        foreignColumns: ['id'],
        foreignTable: 'agent_identity',
        onDelete: 'restrict',
      },
    ])
    expect(foreignKeyReferences(agentIdentityBinding)).toEqual(
      expect.arrayContaining([
        {
          columns: ['agent_identity_id'],
          foreignColumns: ['id'],
          foreignTable: 'agent_identity',
          onDelete: 'restrict',
        },
        {
          columns: ['protocol_agent_id'],
          foreignColumns: ['id'],
          foreignTable: 'agent',
          onDelete: 'restrict',
        },
      ]),
    )
    expect(indexNames(agentEnrollmentIntent)).toEqual(
      expect.arrayContaining([
        'agentEnrollmentIntent_agentIdentityId_idx',
        'agentEnrollmentIntent_protocolAgentId_idx',
        'agentEnrollmentIntent_status_idx',
      ]),
    )
  })

  it('stores Agent DPoP replay state', () => {
    expect(getTableConfig(agentDpopJti).columns.find((column) => column.name === 'jti_hash')).toMatchObject({
      primary: true,
    })
    expect(columnNames(agentDpopJti)).toEqual(
      expect.arrayContaining(['jti_hash', 'key_thumbprint', 'expires_at', 'created_at']),
    )
  })

  it('separates signing, credential custody, scope Entitlements, OAuth state, and audit storage', () => {
    expect(indexNames(providerResourceAuthorization)).toEqual(
      expect.arrayContaining([
        'providerResourceAuthorization_connection_resource_unique',
        'providerResourceAuthorization_providerConnectionId_idx',
        'providerResourceAuthorization_resourceId_idx',
        'providerResourceAuthorization_status_idx',
      ]),
    )
    expect(indexNames(resourceScopeEntitlement)).toEqual(
      expect.arrayContaining([
        'resourceScopeEntitlement_resourceServerId_idx',
        'resourceScopeEntitlement_agentIdentityId_idx',
        'resourceScopeEntitlement_grantedByAgentIdentityId_idx',
        'resourceScopeEntitlement_activeAgent_unique',
        'resourceScopeEntitlement_activeUser_unique',
        'resourceScopeEntitlement_activeApplication_unique',
      ]),
    )
    expect(indexNames(resourceConnectionIntent)).toEqual(
      expect.arrayContaining([
        'resourceConnectionIntent_resourceId_idx',
        'resourceConnectionIntent_status_idx',
        'resourceConnectionIntent_expiresAt_idx',
      ]),
    )
    expect(indexNames(agentAccessRequest)).toContain('agentAccessRequest_status_idx')
    expect(indexNames(externalTokenLease)).toContain('externalTokenLease_requestId_idx')
    expect(indexNames(agentAuditEvent)).toEqual(
      expect.arrayContaining([
        'agentAuditEvent_occurredAt_idx',
        'agentAuditEvent_agentIdentityId_idx',
        'agentAuditEvent_resourceId_idx',
        'agentAuditEvent_result_idx',
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
  agentDpopJti,
  approvalRequest,
  uploadedAsset,
  organization,
  member,
  invitation,
  apiResource,
  organizationRole,
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
