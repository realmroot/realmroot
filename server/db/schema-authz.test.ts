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

describe('schema.test 2', () => {
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
