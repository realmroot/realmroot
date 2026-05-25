import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import {
  account,
  accountCenterSetting,
  accountRelations,
  agent,
  agentCapabilityGrant,
  agentCapabilityGrantRelations,
  agentHost,
  agentHostRelations,
  agentRelations,
  apiPermission,
  apiPermissionRelations,
  apiResource,
  apiResourceRelations,
  apiScope,
  apiScopeRelations,
  application,
  applicationClientMetadata,
  applicationClientSecret,
  applicationConsent,
  applicationRelations,
  applicationRoleAssignment,
  applicationRoleAssignmentRelations,
  approvalRequest,
  approvalRequestRelations,
  brandingSetting,
  customDomain,
  deploymentSetting,
  emailServiceConfig,
  identityProviderConnector,
  invitation,
  jwks,
  member,
  memberRoleAssignment,
  memberRoleAssignmentRelations,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  organization,
  organizationMemberRelations,
  organizationRelations,
  passkey,
  passkeyRelations,
  role,
  rolePermission,
  rolePermissionRelations,
  roleRelations,
  session,
  sessionRelations,
  signInExperience,
  twoFactor,
  twoFactorRelations,
  uploadedAsset,
  user,
  userRelations,
  userRoleAssignment,
  userRoleAssignmentRelations,
  verification,
  webhookDeliveryRequest,
  webhookEndpoint,
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

  it('stores Better Auth JWT key metadata required by generated JWKs', () => {
    expect(columnNames(jwks)).toEqual(
      expect.arrayContaining(['id', 'public_key', 'private_key', 'alg', 'crv', 'created_at', 'expires_at']),
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

  it('keeps FlareAuth product settings and OAuth token tables explicit', () => {
    expect(columnNames(account)).toEqual(expect.arrayContaining(['account_id', 'provider_id', 'user_id']))
    expect(columnNames(verification)).toEqual(expect.arrayContaining(['identifier', 'value', 'expires_at']))
    expect(indexNames(oauthRefreshToken)).toEqual(
      expect.arrayContaining([
        'oauthRefreshToken_clientId_idx',
        'oauthRefreshToken_sessionId_idx',
        'oauthRefreshToken_userId_idx',
      ]),
    )
    expect(indexNames(oauthAccessToken)).toEqual(
      expect.arrayContaining([
        'oauthAccessToken_clientId_idx',
        'oauthAccessToken_sessionId_idx',
        'oauthAccessToken_userId_idx',
        'oauthAccessToken_refreshId_idx',
      ]),
    )
    expect(indexNames(oauthConsent)).toEqual(
      expect.arrayContaining(['oauthConsent_clientId_idx', 'oauthConsent_userId_idx', 'oauthConsent_referenceId_idx']),
    )
    expect(indexNames(uploadedAsset)).toEqual(
      expect.arrayContaining(['uploadedAsset_purpose_idx', 'uploadedAsset_createdByUserId_idx']),
    )
    expect(columnNames(emailServiceConfig)).toEqual(
      expect.arrayContaining(['provider', 'enabled', 'from_email', 'reply_to_email', 'metadata']),
    )
    expect(columnNames(signInExperience)).toEqual(
      expect.arrayContaining(['default_application_id', 'password_enabled', 'identifier_first', 'support_email']),
    )
    expect(indexNames(brandingSetting)).toEqual(
      expect.arrayContaining(['brandingSetting_applicationId_idx', 'brandingSetting_organizationId_idx']),
    )
    expect(indexNames(accountCenterSetting)).toEqual(expect.arrayContaining(['accountCenterSetting_applicationId_idx']))
    expect(indexNames(customDomain)).toEqual(
      expect.arrayContaining([
        'customDomain_applicationId_idx',
        'customDomain_organizationId_idx',
        'customDomain_status_idx',
      ]),
    )
    expect(columnNames(deploymentSetting)).toEqual(expect.arrayContaining(['environment', 'base_url', 'issuer_path']))
  })

  it('models webhook endpoint and delivery request persistence explicitly', () => {
    expect(columnNames(webhookEndpoint)).toEqual(
      expect.arrayContaining(['url', 'events', 'enabled', 'signing_secret', 'secret_prefix', 'created_by_user_id']),
    )
    expect(indexNames(webhookEndpoint)).toEqual(
      expect.arrayContaining(['webhookEndpoint_enabled_idx', 'webhookEndpoint_createdByUserId_idx']),
    )
    expect(foreignKeyReferences(webhookEndpoint)).toContainEqual({
      columns: ['created_by_user_id'],
      foreignColumns: ['id'],
      foreignTable: 'user',
      onDelete: 'set null',
    })

    expect(columnNames(webhookDeliveryRequest)).toEqual(
      expect.arrayContaining([
        'endpoint_id',
        'event',
        'status',
        'attempt_count',
        'request_body',
        'response_body',
        'next_attempt_at',
      ]),
    )
    expect(indexNames(webhookDeliveryRequest)).toEqual(
      expect.arrayContaining([
        'webhookDeliveryRequest_endpointId_idx',
        'webhookDeliveryRequest_status_idx',
        'webhookDeliveryRequest_createdAt_idx',
      ]),
    )
    expect(foreignKeyReferences(webhookDeliveryRequest)).toContainEqual({
      columns: ['endpoint_id'],
      foreignColumns: ['id'],
      foreignTable: 'webhook_endpoint',
      onDelete: 'cascade',
    })
  })

  it('defines relation graphs for auth, organization, application, and authorization records', () => {
    expect(relationKeys(userRelations)).toEqual(
      expect.arrayContaining([
        'sessions',
        'accounts',
        'passkeys',
        'twoFactors',
        'oauthClients',
        'oauthRefreshTokens',
        'oauthAccessTokens',
        'oauthConsents',
        'ownedApplications',
        'organizationMemberships',
        'roleAssignments',
      ]),
    )
    expect(relationKeys(twoFactorRelations)).toEqual(['user'])
    expect(relationKeys(passkeyRelations)).toEqual(['user'])
    expect(relationKeys(agentHostRelations)).toEqual(expect.arrayContaining(['user', 'agents', 'approvalRequests']))
    expect(relationKeys(agentRelations)).toEqual(expect.arrayContaining(['user', 'host', 'grants', 'approvalRequests']))
    expect(relationKeys(agentCapabilityGrantRelations)).toEqual(
      expect.arrayContaining(['agent', 'grantedByUser', 'deniedByUser']),
    )
    expect(relationKeys(approvalRequestRelations)).toEqual(expect.arrayContaining(['agent', 'host', 'user']))
    expect(relationKeys(sessionRelations)).toEqual(['user'])
    expect(relationKeys(accountRelations)).toEqual(['user'])
    expect(relationKeys(organizationRelations)).toEqual(
      expect.arrayContaining(['logoAsset', 'members', 'invitations', 'applications', 'roles']),
    )
    expect(relationKeys(organizationMemberRelations)).toEqual(
      expect.arrayContaining(['organization', 'user', 'roleAssignments']),
    )
    expect(relationKeys(applicationRelations)).toEqual(
      expect.arrayContaining([
        'oauthClient',
        'ownerUser',
        'ownerOrganization',
        'logoAsset',
        'clientSecrets',
        'consents',
        'roleAssignments',
      ]),
    )
    expect(relationKeys(apiResourceRelations)).toEqual(expect.arrayContaining(['scopes', 'permissions', 'roles']))
    expect(relationKeys(apiScopeRelations)).toEqual(expect.arrayContaining(['resource', 'permissions']))
    expect(relationKeys(apiPermissionRelations)).toEqual(
      expect.arrayContaining(['resource', 'scope', 'rolePermissions']),
    )
    expect(relationKeys(roleRelations)).toEqual(
      expect.arrayContaining([
        'resource',
        'organization',
        'application',
        'permissions',
        'userAssignments',
        'applicationAssignments',
        'memberAssignments',
      ]),
    )
    expect(relationKeys(rolePermissionRelations)).toEqual(expect.arrayContaining(['role', 'permission']))
    expect(relationKeys(userRoleAssignmentRelations)).toEqual(expect.arrayContaining(['role', 'user']))
    expect(relationKeys(applicationRoleAssignmentRelations)).toEqual(expect.arrayContaining(['role', 'application']))
    expect(relationKeys(memberRoleAssignmentRelations)).toEqual(expect.arrayContaining(['role', 'member']))
  })

  it('keeps timestamp update hooks executable for mutable records', () => {
    const updateValues = schemaTables
      .flatMap((table) => getTableConfig(table).columns)
      .filter((column) => column.onUpdateFn)
      .map((column) => column.onUpdateFn?.())

    expect(updateValues).toHaveLength(21)
    for (const value of updateValues) {
      expect(value).toBeInstanceOf(Date)
    }
  })
})

const schemaTables = [
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

function relationKeys(relationsObject: { config: (helpers: never) => Record<string, unknown> }) {
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
