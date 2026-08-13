import { platformOrganization } from '@server/domain/platform-organization'
import { realmrootResourceServer } from '@server/domain/realmroot-resource-server'
import type { Deps } from '@server/usecases/deps'
import { createIdentifierGeneratorFake } from '@server/usecases/identifier-generator.fake'
import type { ProviderConnectionRecord } from '@server/usecases/ports'
import type { SecurityPolicy } from '@shared/api/security'
import { realmrootScopeRegistry } from '@shared/scope-registry'
import { vi } from 'vitest'

const platformOrganizationId = 'org-platform'
const realmrootResourceServerId = 'resource-realmroot'
const realmrootResource = {
  id: realmrootResourceServerId,
  ...realmrootResourceServer,
  resourceUrl: 'https://auth.example.com/api',
  authorizationModel: 'native' as const,
  connectorId: null,
  authorizationDetails: [],
  enabled: true,
  ownerOrganizationId: platformOrganizationId,
  visibility: 'public' as const,
  scopeRegistry: {
    discovery: {
      sourceUrl: 'https://auth.example.com/api/openapi.json',
      etag: null,
      documentHash: 'system-managed',
      syncedAt: '2026-01-01T00:00:00.000Z',
      lastError: null,
    },
    scopes: Object.keys(realmrootScopeRegistry).map((value) => ({
      value,
      description: null,
      grantMode: 'assigned' as const,
    })),
  },
  availableToAgents: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

export function testSecurityPolicy(): SecurityPolicy {
  return {
    mfa: { mode: 'optional', emailOtpEnabled: false, authenticatorAppEnabled: true },
    passkeys: {
      enabled: true,
      rpId: 'auth.example.com',
      rpName: 'Realmroot',
      origins: ['https://auth.example.com'],
    },
    sessions: {
      expiresInSeconds: 60 * 60 * 24 * 7,
      updateAgeSeconds: 60 * 60 * 24,
      freshAgeSeconds: 60 * 60 * 24,
      cookieCacheSeconds: 60 * 5,
    },
    password: {
      minLength: 8,
      requiredCharacterTypes: 1,
      customWords: [],
      rejectUserInfo: false,
      rejectSequential: false,
      rejectCustomWords: false,
    },
    captcha: { enabled: false, provider: 'turnstile', siteKey: '', projectId: null, secretKey: '' },
    blocklist: { blockSubaddressing: false, entries: [] },
  } as SecurityPolicy
}

function emptyPage() {
  return { items: [], total: 0, limit: 20, offset: 0 }
}

/**
 * A permissive fake Deps for route/app tests. Every port is a vi.fn with a
 * benign default; tests override only the slices they exercise via `overrides`.
 */
export function createTestDeps(overrides: Partial<Record<keyof Deps, unknown>> = {}): Deps {
  let currentProviderConnection: ProviderConnectionRecord | null = null
  const policy = testSecurityPolicy()
  const platformOwnerMembership = {
    id: 'member-platform-owner',
    organizationId: platformOrganizationId,
    userId: 'admin-1',
    roles: ['owner'],
  }
  const base = {
    ids: createIdentifierGeneratorFake(),
    agents: {
      listHosts: vi.fn().mockResolvedValue(emptyPage()),
      listAgents: vi.fn().mockResolvedValue(emptyPage()),
      listCapabilityGrants: vi.fn().mockResolvedValue(emptyPage()),
      listApprovalRequests: vi.fn().mockResolvedValue(emptyPage()),
      findApprovalRequest: vi.fn().mockResolvedValue(null),
      createApprovalRequest: vi.fn().mockImplementation(async (record) => record),
      listAgentsForUser: vi.fn().mockResolvedValue(emptyPage()),
      listHostsForAgents: vi.fn().mockResolvedValue([]),
      listCapabilityGrantsForUser: vi.fn().mockResolvedValue([]),
      listCapabilityGrantsForAgent: vi.fn().mockResolvedValue([]),
      decideApproval: vi.fn(),
      revokeAgentForUser: vi.fn().mockResolvedValue(undefined),
      revokeCapabilityGrantForUser: vi.fn().mockResolvedValue(undefined),
      revokeAgent: vi.fn().mockResolvedValue(undefined),
      revokeHost: vi.fn().mockResolvedValue(undefined),
      revokeCapabilityGrant: vi.fn().mockResolvedValue(undefined),
    },
    agentAudit: {
      append: vi.fn(),
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      summarizeByDay: vi.fn().mockResolvedValue([]),
    },
    agentIdentities: {
      listPersonal: vi.fn().mockResolvedValue([]),
      listOrganization: vi.fn().mockResolvedValue([]),
      listOwned: vi.fn().mockResolvedValue(emptyPage()),
      listAll: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      findIdentity: vi.fn().mockResolvedValue(null),
      findByIssuerSubject: vi.fn().mockResolvedValue(null),
      findByIssuerUsername: vi.fn().mockResolvedValue(null),
      findByUsername: vi.fn().mockResolvedValue(null),
      findIntent: vi.fn().mockResolvedValue(null),
      findIntentByIdempotencyKey: vi.fn().mockResolvedValue(null),
      findLatestApprovedIdentityIntent: vi.fn().mockResolvedValue(null),
      findProtocolAgent: vi.fn().mockResolvedValue(null),
      findBindingByProtocolAgent: vi.fn().mockResolvedValue(null),
      findActiveByProtocolAgent: vi.fn().mockResolvedValue(null),
      createIdentity: vi.fn(),
      claimIdentityProfile: vi.fn().mockResolvedValue(null),
      createIntent: vi.fn(),
      createIntentIdempotently: vi.fn(),
      approveIntent: vi.fn(),
      revokeBinding: vi.fn().mockResolvedValue(false),
      deactivateIdentity: vi.fn().mockResolvedValue(false),
      activateIdentity: vi.fn().mockResolvedValue(false),
      deleteIdentity: vi.fn().mockResolvedValue(false),
    },
    agentTokens: {
      consumeAgentAuthJti: vi.fn().mockResolvedValue(true),
      consumeDpopJti: vi.fn().mockResolvedValue(true),
    },
    applications: {
      create: vi.fn(),
      list: vi.fn().mockResolvedValue({
        items: [],
        pagination: { limit: 100, offset: 0, total: 0, hasMore: false, nextOffset: null },
      }),
      findById: vi.fn().mockResolvedValue(null),
      findByClientId: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      delete: vi.fn(),
      listSecrets: vi.fn().mockResolvedValue({
        items: [],
        pagination: { limit: 20, offset: 0, total: 0, hasMore: false, nextOffset: null },
      }),
      rotateSecret: vi.fn(),
      listAuthorizations: vi.fn().mockResolvedValue({
        items: [],
        pagination: { limit: 50, offset: 0, total: 0, hasMore: false, nextOffset: null },
      }),
      findAuthorization: vi.fn().mockResolvedValue(null),
      revokeAuthorization: vi.fn().mockResolvedValue(true),
      findConsent: vi.fn().mockResolvedValue(null),
      revokeConsent: vi.fn().mockResolvedValue(true),
      createConsent: vi.fn(),
      recordPolicyAuthorization: vi.fn(),
    },
    assets: {
      createAsset: vi.fn(),
      findAsset: vi.fn().mockResolvedValue(null),
      updateUserAvatar: vi.fn(),
      updateApplicationLogo: vi.fn(),
      updateOrganizationLogo: vi.fn(),
      updateBrandingAsset: vi.fn(),
    },
    assetStorage: { put: vi.fn(), get: vi.fn().mockResolvedValue(null) },
    authorization: {
      listOrganizations: vi.fn().mockResolvedValue({
        items: [
          {
            id: platformOrganizationId,
            slug: platformOrganization.slug,
            name: platformOrganization.name,
            displayName: null,
            logo: null,
            disabled: false,
            disabledReason: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false, nextOffset: null },
      }),
      listResources: vi.fn().mockResolvedValue({
        items: [realmrootResource],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false, nextOffset: null },
      }),
      listEnabledResources: vi.fn().mockResolvedValue([]),
      findResources: vi.fn().mockResolvedValue([]),
      findResourceByResourceUrl: vi.fn().mockResolvedValue(null),
      listUserMemberships: vi
        .fn()
        .mockImplementation(async (userId) =>
          userId === platformOwnerMembership.userId ? [platformOwnerMembership] : [],
        ),
      listMemberUserIds: vi.fn().mockResolvedValue([]),
      listOrganizationRoles: vi.fn().mockResolvedValue([]),
      listOrganizationRoleScopes: vi.fn().mockResolvedValue(new Map()),
      findMemberByOrganizationUser: vi
        .fn()
        .mockImplementation(async (organizationId, userId) =>
          organizationId === platformOrganizationId && userId === platformOwnerMembership.userId
            ? platformOwnerMembership
            : null,
        ),
      findOrganization: vi.fn().mockImplementation(async (id) =>
        id === platformOrganizationId
          ? {
              id: platformOrganizationId,
              slug: platformOrganization.slug,
              name: platformOrganization.name,
              displayName: null,
              logo: null,
              disabled: false,
              disabledReason: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            }
          : null,
      ),
      findResource: vi
        .fn()
        .mockImplementation(async (id) => (id === realmrootResourceServerId ? realmrootResource : null)),
      createResource: vi.fn().mockImplementation(async (input) => ({
        ...input,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
      updateResource: vi.fn().mockResolvedValue(true),
      replaceResourceDiscovery: vi.fn().mockResolvedValue(true),
      listActiveUserScopeEntitlements: vi.fn().mockResolvedValue([]),
      listActiveApplicationScopeEntitlements: vi.fn().mockResolvedValue([]),
      hasPendingInvitation: vi.fn().mockResolvedValue(false),
    },
    configz: {
      getSettings: vi.fn().mockResolvedValue(null),
      getBranding: vi.fn().mockResolvedValue(null),
      getAccountCenterSettings: vi.fn().mockResolvedValue(null),
      getOrganizationCreationPolicy: vi.fn().mockResolvedValue({ mode: 'admins_only', approvedUserIds: [] }),
      getDeveloperConsoleAccessPolicy: vi.fn().mockResolvedValue({
        mode: 'realm_operators',
        eligibleAccessLevels: ['owner', 'admin', 'developer'],
        selectedOrganizationIds: [],
      }),
      getEmailSettings: vi.fn().mockResolvedValue(null),
      listEnabledIdentityProviders: vi.fn().mockResolvedValue([]),
      updateSettings: vi.fn(),
      updateBranding: vi.fn(),
      updateAccountCenterSettings: vi.fn(),
      updateOrganizationCreationPolicy: vi.fn(),
      updateDeveloperConsoleAccessPolicy: vi.fn(),
      updateEmailSettings: vi.fn(),
    },
    connectors: {
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listEnabled: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      findByProviderId: vi.fn().mockResolvedValue(null),
      countResourceReferences: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    externalResources: {
      connectAuthenticationAccount: vi.fn().mockResolvedValue(null),
      disconnectAuthenticationAccount: vi.fn(),
      upsertProviderConnection: vi.fn().mockImplementation(async (input) => {
        currentProviderConnection = input
        return input
      }),
      findProviderConnectionByOwnerConnector: vi.fn().mockResolvedValue(null),
      findActiveUserProviderConnectionByProviderSubject: vi.fn().mockResolvedValue(null),
      findProviderConnection: vi.fn().mockResolvedValue(null),
      listProviderConnectionsByUser: vi.fn().mockResolvedValue([]),
      revokeProviderConnection: vi.fn().mockResolvedValue(false),
      createResourceAuthorization: vi.fn().mockImplementation(async (input) => ({
        ...input,
        ownerUserId: currentProviderConnection ? currentProviderConnection.ownerUserId : 'user-1',
        ownerOrganizationId: currentProviderConnection ? currentProviderConnection.ownerOrganizationId : null,
        externalSubject: currentProviderConnection?.externalSubject ?? 'external-user-1',
        displayName: currentProviderConnection?.displayName ?? 'External User',
        grantedScopes: input.credentials.flatMap((credential: { grantedScopes: string[] }) => credential.grantedScopes),
        authorizationDetails: input.credentials.flatMap(
          (credential: { authorizationDetails: unknown[] }) => credential.authorizationDetails,
        ),
      })),
      findConnectionByOwnerResource: vi.fn().mockResolvedValue(null),
      findConnectionByProviderResource: vi.fn().mockResolvedValue(null),
      upsertProviderCredential: vi.fn().mockResolvedValue(null),
      listConnectionsByUser: vi.fn().mockResolvedValue([]),
      listConnectionsByOrganizations: vi.fn().mockResolvedValue([]),
      findConnection: vi.fn().mockResolvedValue(null),
      updateProviderCredentialTokens: vi.fn().mockResolvedValue(null),
      claimProviderCredentialRefresh: vi.fn().mockResolvedValue(true),
      completeProviderCredentialRefresh: vi.fn().mockResolvedValue({ id: 'credential-refreshed' }),
      releaseProviderCredentialRefresh: vi.fn().mockResolvedValue(true),
      revokeProviderCredential: vi.fn().mockResolvedValue(false),
      revokeConnection: vi.fn().mockResolvedValue(false),
      createConnectionIntent: vi.fn().mockImplementation(async (input) => input),
      consumeConnectionIntent: vi.fn().mockResolvedValue(null),
      createAgentConnectionRequest: vi.fn().mockImplementation(async (input) => input),
      findAgentConnectionRequest: vi.fn().mockResolvedValue(null),
      findAgentConnectionRequestByApprovalTokenHash: vi.fn().mockResolvedValue(null),
      createAccessRequest: vi.fn().mockImplementation(async (input) => input),
      createAccessRequestWithAudit: vi.fn().mockImplementation(async (input) => input),
      findAccessRequest: vi.fn().mockResolvedValue(null),
      findAccessRequestByApprovalTokenHash: vi.fn().mockResolvedValue(null),
      listPendingAccessRequestsByAgent: vi.fn().mockResolvedValue([]),
      listPendingAccessRequests: vi.fn().mockResolvedValue([]),
      decideAccessRequest: vi.fn().mockResolvedValue(null),
      decideAccessRequestWithAudit: vi.fn().mockResolvedValue(null),
      consumeAccessRequest: vi.fn().mockResolvedValue(false),
      listPendingAccessRequestsByConnections: vi.fn().mockResolvedValue([]),
      approveAccessRequestWithEntitlements: vi
        .fn()
        .mockImplementation(async (entitlements, _updates, requestId, decision) => ({
          entitlements,
          request: { id: requestId, ...decision },
        })),
      findEntitlement: vi.fn().mockResolvedValue(null),
      findEntitlements: vi.fn(async (ids: string[]) => {
        const records = await Promise.all(ids.map((id) => base.externalResources.findEntitlement(id)))
        return records.filter((record) => record !== null)
      }),
      listActiveEntitlementsByAgent: vi.fn().mockResolvedValue([]),
      listAgentPermissions: vi.fn().mockResolvedValue(emptyPage()),
      summarizeAgentAccess: vi.fn().mockResolvedValue(new Map()),
      listActiveEntitlementsByConnection: vi.fn().mockResolvedValue([]),
      endEntitlement: vi.fn().mockResolvedValue(false),
      endEntitlementWithAudit: vi.fn().mockResolvedValue(false),
      createTokenLease: vi.fn().mockImplementation(async (input) => input),
      issueTokenLeaseWithAudit: vi.fn().mockImplementation(async (input) => input),
      listActiveTokenLeasesByEntitlement: vi.fn().mockResolvedValue([]),
      listActiveTokenLeasesByBinding: vi.fn().mockResolvedValue([]),
      findActiveTokenLeaseByTokenHash: vi.fn().mockResolvedValue(null),
      revokeTokenLease: vi.fn().mockResolvedValue(false),
    },
    externalHttp: { fetch: vi.fn() },
    onboarding: {
      hasUsers: vi.fn().mockResolvedValue(true),
      createBootstrapAdmin: vi.fn(),
    },
    security: {
      getPolicy: vi.fn().mockResolvedValue(policy),
      updatePolicy: vi.fn().mockResolvedValue(policy),
      getSecurityState: vi.fn().mockResolvedValue({
        userId: 'user-1',
        mfa: { enabled: true, factors: [{ id: 'factor-1', type: 'totp', verified: true }] },
        passkeys: { enabled: true, count: 1 },
        policy,
      }),
      listPasskeys: vi.fn().mockResolvedValue(emptyPage()),
      deletePasskey: vi.fn(),
      getSessionToken: vi.fn().mockResolvedValue('session-token-1'),
    },
    secrets: {
      isSealed: vi.fn((value: string) => value.startsWith('sealed:')),
      seal: vi.fn(async (value: string) => `sealed:${value}`),
      open: vi.fn(async (value: string) => value.replace(/^sealed:/, '')),
    },
    tokenExchange: {
      findClient: vi.fn().mockResolvedValue(null),
      findFederatedCredentials: vi.fn().mockResolvedValue([]),
      findFederatedCredentialForClient: vi.fn().mockResolvedValue(null),
      listFederatedCredentials: vi.fn().mockResolvedValue([]),
      getFederatedCredential: vi.fn().mockResolvedValue(null),
      createFederatedCredential: vi.fn(),
      updateFederatedCredential: vi.fn().mockResolvedValue(null),
      deleteFederatedCredential: vi.fn().mockResolvedValue(false),
      storeAccessToken: vi.fn(),
      findAccessTokenByHash: vi.fn().mockResolvedValue(null),
      storeRefreshToken: vi.fn().mockResolvedValue(true),
      findRefreshTokenByHash: vi.fn().mockResolvedValue(null),
      consumeRefreshToken: vi.fn().mockResolvedValue(false),
      revokeRefreshTokenFamily: vi.fn(),
    },
    users: {
      getUser: vi.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          email: `${id}@example.com`,
          emailVerified: true,
          role: 'user',
        }),
      ),
      getPublicProfile: vi.fn().mockImplementation(async (id: string) => ({
        user: {
          id,
          email: `${id}@example.com`,
          emailVerified: true,
          role: 'user',
        },
        bio: null,
        location: null,
        links: [],
        profileUpdatedAt: null,
      })),
      findPublicProfileByUsername: vi.fn().mockResolvedValue(null),
      listManagedUsers: vi.fn().mockResolvedValue(emptyPage()),
      createManagedUser: vi.fn(),
      updateManagedUser: vi.fn(),
      suspendManagedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
      restoreManagedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
      deleteManagedUser: vi.fn(),
      updateProfile: vi.fn(),
      assertAccountAvatarReference: vi.fn(),
      assertAdminAvatarReference: vi.fn(),
      listLinkedAccounts: vi.fn().mockResolvedValue(emptyPage()),
      listSessions: vi.fn().mockResolvedValue(emptyPage()),
      getSessionToken: vi.fn().mockResolvedValue('session-token-1'),
      deleteSessions: vi.fn().mockResolvedValue([]),
    },
    wallets: {
      findWalletAddress: vi.fn().mockResolvedValue(null),
      findAnyWalletAddress: vi.fn().mockResolvedValue(null),
      getSiweNonce: vi.fn().mockResolvedValue(null),
      deleteSiweNonce: vi.fn(),
      linkWalletAddress: vi.fn(),
      unlinkWalletAddress: vi.fn(),
    },
    webhooks: {
      listEndpoints: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listSubscribedEndpoints: vi.fn().mockResolvedValue([]),
      findEndpoint: vi.fn().mockResolvedValue(null),
      createEndpoint: vi.fn(),
      updateEndpoint: vi.fn(),
      deleteEndpoint: vi.fn(),
      listRequests: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      findRequest: vi.fn().mockResolvedValue(null),
      createRequest: vi.fn(),
      updateRequest: vi.fn(),
      listAttempts: vi.fn().mockResolvedValue(emptyPage()),
      findAttempt: vi.fn().mockResolvedValue(null),
      findAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      reserveAttempt: vi.fn(),
      updateAttempt: vi.fn(),
    },
    email: { send: vi.fn() },
    jwks: { fetchKeys: vi.fn() },
  }

  base.externalResources.createAccessRequestWithAudit.mockImplementation(async (input, audit) => {
    const request = await base.externalResources.createAccessRequest(input)
    if (request) await base.agentAudit.append(audit)
    return request
  })
  base.externalResources.decideAccessRequestWithAudit.mockImplementation(async (id, input, audit) => {
    const request = await base.externalResources.decideAccessRequest(id, input)
    if (request) await base.agentAudit.append(audit)
    return request
  })
  base.externalResources.approveAccessRequestWithEntitlements.mockImplementation(
    async (entitlements, _updates, requestId, decision, audit) => {
      const request = await base.externalResources.decideAccessRequest(requestId, decision)
      if (request) await base.agentAudit.append(audit)
      return request ? { entitlements, request } : 'request_changed'
    },
  )
  base.externalResources.issueTokenLeaseWithAudit.mockImplementation(
    async (input, _consumeEntitlementIds, now, audit) => {
      const lease = await base.externalResources.createTokenLease(input)
      if (!lease) return null
      await base.externalResources.consumeAccessRequest(input.requestId, now)
      await base.agentAudit.append(audit)
      return lease
    },
  )
  base.externalResources.endEntitlementWithAudit.mockImplementation(async (id, reason, tokenLeaseIds, now, audit) => {
    for (const leaseId of tokenLeaseIds) await base.externalResources.revokeTokenLease(leaseId, now)
    const revoked = await base.externalResources.endEntitlement(id, reason, now)
    await base.agentAudit.append(audit)
    return revoked
  })

  return Object.fromEntries(
    Object.entries(base).map(([key, value]) => [
      key,
      { ...value, ...((overrides[key as keyof Deps] as object | undefined) ?? {}) },
    ]),
  ) as unknown as Deps
}
