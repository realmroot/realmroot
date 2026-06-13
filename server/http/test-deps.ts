import type { Deps } from '@server/usecases/deps'
import type { SecurityPolicy } from '@shared/api/security'
import { vi } from 'vitest'

export function testSecurityPolicy(): SecurityPolicy {
  return {
    mfa: { mode: 'optional', emailOtpEnabled: false, authenticatorAppEnabled: true },
    passkeys: {
      enabled: true,
      rpId: 'auth.example.com',
      rpName: 'FlareAuth',
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
    captcha: { enabled: false, provider: 'turnstile', siteKey: '', secretBinding: '' },
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
  const policy = testSecurityPolicy()
  const base = {
    agents: {
      listHosts: vi.fn().mockResolvedValue(emptyPage()),
      listAgents: vi.fn().mockResolvedValue(emptyPage()),
      listCapabilityGrants: vi.fn().mockResolvedValue(emptyPage()),
      listApprovalRequests: vi.fn().mockResolvedValue(emptyPage()),
      listAgentsForUser: vi.fn().mockResolvedValue(emptyPage()),
      listHostsForAgents: vi.fn().mockResolvedValue([]),
      listCapabilityGrantsForUser: vi.fn().mockResolvedValue([]),
      revokeAgentForUser: vi.fn().mockResolvedValue(undefined),
      revokeCapabilityGrantForUser: vi.fn().mockResolvedValue(undefined),
      revokeAgent: vi.fn().mockResolvedValue(undefined),
      revokeHost: vi.fn().mockResolvedValue(undefined),
      revokeCapabilityGrant: vi.fn().mockResolvedValue(undefined),
    },
    applications: {
      create: vi.fn(),
      upsertSystem: vi.fn(),
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
      findConsent: vi.fn().mockResolvedValue(null),
      revokeConsent: vi.fn().mockResolvedValue(true),
      createConsent: vi.fn(),
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
    authorization: {},
    configz: {
      getSettings: vi.fn().mockResolvedValue(null),
      getBranding: vi.fn().mockResolvedValue(null),
      getAccountCenterSettings: vi.fn().mockResolvedValue(null),
      listEnabledIdentityProviders: vi.fn().mockResolvedValue([]),
      updateSettings: vi.fn(),
      updateBranding: vi.fn(),
      updateAccountCenterSettings: vi.fn(),
    },
    connectors: {
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listEnabled: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      findByProviderId: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
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
    tokenExchange: {
      findClient: vi.fn().mockResolvedValue(null),
      findTrustedIssuer: vi.fn().mockResolvedValue(null),
      createTrustedIssuer: vi.fn(),
      listTrustedIssuers: vi.fn().mockResolvedValue([]),
      storeAccessToken: vi.fn(),
      findAccessTokenByHash: vi.fn().mockResolvedValue(null),
    },
    users: {
      getUser: vi.fn(),
      listManagedUsers: vi.fn().mockResolvedValue(emptyPage()),
      createManagedUser: vi.fn(),
      updateManagedUser: vi.fn(),
      deleteManagedUser: vi.fn(),
      updateProfile: vi.fn(),
      assertAccountAvatarReference: vi.fn(),
      assertAdminAvatarReference: vi.fn(),
      listLinkedAccounts: vi.fn().mockResolvedValue(emptyPage()),
      listConsentedApplications: vi.fn().mockResolvedValue(emptyPage()),
      listSessions: vi.fn().mockResolvedValue(emptyPage()),
      getSessionToken: vi.fn().mockResolvedValue('session-token-1'),
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
      findEndpoint: vi.fn().mockResolvedValue(null),
      createEndpoint: vi.fn(),
      updateEndpoint: vi.fn(),
      deleteEndpoint: vi.fn(),
      listRequests: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      findRequest: vi.fn().mockResolvedValue(null),
      updateRequest: vi.fn(),
    },
    email: { send: vi.fn() },
    jwks: { fetchKeys: vi.fn() },
  }

  return { ...base, ...overrides } as unknown as Deps
}
