import { createApp } from '@server/http/app'
import * as applications from '@server/usecases/applications'
import * as configz from '@server/usecases/configz'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDeps } from './test-deps'

type ConfigzConfig = Awaited<ReturnType<typeof configz.getConfig>>
type ListApplicationsResponse = Awaited<ReturnType<typeof applications.listApplications>>

describe('app.test 2', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits CORS response headers for raw auth handler responses', async () => {
    const response = await createApp(createAuthMock(), createTestDeps(), {
      trustedOrigins: ['https://tenant.example.com'],
    }).request('/api/auth/session', {
      headers: {
        origin: 'https://tenant.example.com',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://tenant.example.com')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('allows application CORS origins on OAuth discovery without deployment-level trust', async () => {
    const auth = createAuthMock()
    auth.api.getOpenIdConfig.mockResolvedValue({
      issuer: 'https://auth.example.com/api/auth',
      authorization_endpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
      token_endpoint: 'https://auth.example.com/api/auth/oauth2/token',
      jwks_uri: 'https://auth.example.com/api/auth/jwks',
      userinfo_endpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
    })
    mockApplicationCors(['https://app.example.com'])
    const response = await createApp(auth, createTestDeps(), {
      trustedOrigins: ['https://tenant.example.com'],
    }).request('/api/auth/.well-known/openid-configuration', {
      headers: {
        origin: 'https://app.example.com',
      },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('allows public OAuth metadata reads from unregistered browser origins', async () => {
    const auth = createAuthMock()
    auth.api.getOpenIdConfig.mockResolvedValue({
      issuer: 'https://auth.example.com/api/auth',
      authorization_endpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
      token_endpoint: 'https://auth.example.com/api/auth/oauth2/token',
      jwks_uri: 'https://auth.example.com/api/auth/jwks',
      userinfo_endpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
    })

    mockApplicationCors([])
    const response = await createApp(auth, createTestDeps(), {
      trustedOrigins: ['https://tenant.example.com'],
    }).request('/api/auth/.well-known/openid-configuration', {
      headers: {
        origin: 'https://unknown.example.com',
      },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://unknown.example.com')
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('allows application CORS origins for OAuth token preflight', async () => {
    const auth = createAuthMock()
    mockApplicationCors(['https://app.example.com'])
    const response = await createApp(auth, createTestDeps(), {
      trustedOrigins: ['https://tenant.example.com'],
    }).request('/api/auth/oauth2/token', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-headers': 'authorization,content-type',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
    expect(auth.handler).not.toHaveBeenCalled()
  })

  it('rejects unconfigured origins for OAuth client endpoints', async () => {
    mockApplicationCors(['https://app.example.com'])
    const response = await createApp(createAuthMock(), createTestDeps(), {
      trustedOrigins: ['https://tenant.example.com'],
    }).request('/api/auth/oauth2/token', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example.com',
      },
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'forbidden', message: 'Origin is not trusted for this issuer.' },
    })
  })

  it('keeps first-party API routes restricted to deployment-level trusted origins', async () => {
    mockApplicationCors(['https://app.example.com'])
    const response = await createApp(createAuthMock(), createTestDeps({ users: createUserRepositoryMock() }), {
      trustedOrigins: ['https://tenant.example.com'],
    }).request('/api/account/profile', {
      headers: {
        origin: 'https://app.example.com',
        'x-user-id': 'user-1',
      },
    })

    expect(response.status).toBe(403)
  })

  it('blocks password auth endpoints when hosted password auth is disabled [spec: hosted-auth/passwordless-linkage]', async () => {
    const auth = createAuthMock()
    mockConfig({
      signIn: { passwordEnabled: false, signupEnabled: true, socialLoginEnabled: true, emailOtpEnabled: true },
    })

    const response = await createApp(auth, createTestDeps()).request('/api/auth/sign-in/username', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin2026' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'forbidden', message: 'Password authentication is disabled.' },
    })
    expect(auth.handler).not.toHaveBeenCalled()
  })

  it('blocks email OTP sign-in while allowing email verification when email code sign-in is disabled [spec: hosted-auth/email-otp] [spec: connectors-and-methods/connectors-email]', async () => {
    const auth = createAuthMock()
    mockConfig({
      signIn: { passwordEnabled: true, signupEnabled: true, socialLoginEnabled: true, emailOtpEnabled: false },
    })
    const app = createApp(auth, createTestDeps())

    const signInCode = await app.request('/api/auth/email-otp/send-verification-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', type: 'sign-in' }),
    })
    const missingTypeCode = await app.request('/api/auth/email-otp/send-verification-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' }),
    })
    const verificationCode = await app.request('/api/auth/email-otp/send-verification-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', type: 'email-verification' }),
    })
    const verifyEmail = await app.request('/api/auth/email-otp/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', otp: '123456' }),
    })

    expect(signInCode.status).toBe(403)
    expect(missingTypeCode.status).toBe(403)
    expect(verificationCode.status).toBe(204)
    expect(verifyEmail.status).toBe(204)
    expect(auth.handler).toHaveBeenCalledTimes(2)
  })

  it('blocks SIWE sign-in before Better Auth can create an unlinked wallet account [spec: connectors-and-methods/provider-disabled-endpoint-enforcement]', async () => {
    const auth = createAuthMock()
    const wallets = createWalletRepositoryMock({ linked: false })
    mockConfig()
    const response = await createApp(auth, createTestDeps({ wallets })).request('/api/auth/siwe/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        walletAddress: '0x0000000000000000000000000000000000000001',
        chainId: 1,
      }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'forbidden', message: 'This wallet is not linked to an existing account.' },
    })
    expect(auth.handler).not.toHaveBeenCalled()
  })

  it('allows SIWE sign-in for an already linked wallet [spec: account-center/web3-wallet-sign-in]', async () => {
    const auth = createAuthMock()
    const wallets = createWalletRepositoryMock({ linked: true })
    mockConfig()
    const response = await createApp(auth, createTestDeps({ wallets })).request('/api/auth/siwe/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        walletAddress: '0x0000000000000000000000000000000000000001',
        chainId: 1,
      }),
    })

    expect(response.status).toBe(204)
    expect(auth.handler).toHaveBeenCalled()
  })

  it('mounts admin authorization routes behind the admin auth boundary', async () => {
    const app = createApp(createAuthMock(), createTestDeps())

    const organizations = await app.request('/api/management/organizations')
    const resources = await app.request('/api/management/api-resources')
    const roles = await app.request('/api/management/roles')

    expect(organizations.status).toBe(401)
    expect(resources.status).toBe(401)
    expect(roles.status).toBe(401)
  })
})

function createAuthMock() {
  return {
    api: {
      getOAuthServerConfig: vi.fn(),
      getOpenIdConfig: vi.fn(),
      getAgentConfiguration: vi.fn(),
      getSession: vi.fn().mockImplementation(({ headers }: { headers: Headers }) => {
        const id = headers.get('x-user-id')
        if (!id) return null

        return {
          session: { id: 'session-1' },
          user: {
            id,
            email: `${id}@example.com`,
            role: headers.get('x-user-role'),
          },
        }
      }),
    },
    handler: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  }
}

function mockConfig(overrides: Record<string, unknown> = {}) {
  return vi.spyOn(configz, 'getConfig').mockResolvedValue(configFixture(overrides) as ConfigzConfig)
}

function configFixture(overrides: Record<string, unknown> = {}) {
  return {
    signIn: {
      passwordEnabled: true,
      signupEnabled: true,
      socialLoginEnabled: true,
      emailOtpEnabled: true,
      usernameEnabled: true,
      identifierFirst: false,
    },
    builtInProviders: {
      email: { enabled: true },
      phone: { enabled: false },
      web3Wallet: { enabled: true, chains: [1], allowSignUp: true },
      passkey: { allowSignUp: true },
      oneTap: {
        enabled: false,
        clientId: '',
        autoSelect: false,
        cancelOnTapOutside: true,
        uxMode: 'popup',
        context: 'signin',
        promptBaseDelayMs: 1000,
        promptMaxAttempts: 5,
      },
    },
    accountCenter: {
      profileEditingEnabled: true,
      displayNameEditable: true,
      usernameEditable: true,
      avatarEditable: true,
      emailChangeEnabled: true,
      passwordChangeEnabled: true,
      connectedAccountsEnabled: true,
      sessionsViewEnabled: true,
      dangerZoneEnabled: false,
    },
    ...overrides,
  }
}

function mockApplicationCors(origins: string[]) {
  return vi.spyOn(applications, 'listApplications').mockResolvedValue({
    applications: [
      applicationResponse({ corsOrigins: origins }),
      applicationResponse({ disabled: true, corsOrigins: ['https://disabled.example.com'] }),
    ],
    pagination: { limit: 100, offset: 0, total: 2, hasMore: false, nextOffset: null },
  } as unknown as ListApplicationsResponse)
}

function applicationResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    slug: 'customer-portal',
    name: 'Customer Portal',
    description: null,
    homepageUrl: 'https://app.example.com',
    iconUrl: null,
    clientId: 'client-1',
    clientType: 'public_spa',
    public: true,
    firstParty: false,
    trusted: false,
    systemManaged: false,
    disabled: false,
    disabledReason: null,
    redirectUris: ['https://app.example.com/callback'],
    postLogoutRedirectUris: [],
    corsOrigins: [],
    customData: {},
    allowedGrantTypes: ['authorization_code'],
    allowedScopes: ['openid'],
    requirePkce: true,
    tokenEndpointAuthMethod: 'none',
    secretMetadata: [],
    oidc: {
      issuer: 'https://auth.example.com/api/auth',
      authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
      tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
      jwksUri: 'https://auth.example.com/api/auth/jwks',
      userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
      endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/end-session',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function createWalletRepositoryMock({ linked }: { linked: boolean }) {
  const wallet = linked
    ? {
        id: 'wallet-1',
        userId: 'user-1',
        address: '0x0000000000000000000000000000000000000001',
        chainId: 1,
        isPrimary: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }
    : null
  return {
    findWalletAddress: vi.fn().mockResolvedValue(wallet),
    findAnyWalletAddress: vi.fn().mockResolvedValue(wallet),
    getSiweNonce: vi.fn().mockResolvedValue(null),
    deleteSiweNonce: vi.fn().mockResolvedValue(undefined),
    linkWalletAddress: vi.fn().mockResolvedValue(wallet),
    unlinkWalletAddress: vi.fn().mockResolvedValue(undefined),
  }
}

function _createAssetServiceMock() {
  return {
    upload: vi.fn().mockResolvedValue({
      asset: {
        id: 'asset-1',
        purpose: 'avatar',
        publicUrl: 'https://auth.example.com/api/assets/asset-1',
        contentType: 'image/png',
        byteSize: 6,
        checksumSha256: 'checksum-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    }),
    updateUserAvatar: vi.fn().mockResolvedValue(undefined),
  }
}

function createUserRepositoryMock() {
  return {
    getUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    listManagedUsers: vi.fn().mockResolvedValue(createPage()),
    createManagedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    updateManagedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    deleteManagedUser: vi.fn().mockResolvedValue(undefined),
    updateProfile: vi.fn().mockResolvedValue({ id: 'user-1' }),
    assertAccountAvatarReference: vi.fn().mockResolvedValue(undefined),
    assertAdminAvatarReference: vi.fn().mockResolvedValue(undefined),
    listLinkedAccounts: vi.fn().mockResolvedValue(createPage()),
    listConsentedApplications: vi.fn().mockResolvedValue(createPage()),
    listSessions: vi.fn().mockResolvedValue(createPage()),
    getSessionToken: vi.fn().mockResolvedValue('session-token-1'),
  }
}

function _createSecurityRepositoryMock() {
  return {
    getPolicy: vi.fn().mockResolvedValue(securityPolicy()),
    updatePolicy: vi.fn().mockResolvedValue(securityPolicy()),
    getSecurityState: vi.fn().mockResolvedValue({
      userId: 'user-1',
      mfa: { enabled: true, factors: [{ id: 'factor-1', type: 'totp', verified: true }] },
      passkeys: { enabled: true, count: 1 },
      policy: securityPolicy(),
    }),
    listPasskeys: vi.fn().mockResolvedValue(createPage()),
    deletePasskey: vi.fn().mockResolvedValue(undefined),
    getSessionToken: vi.fn().mockResolvedValue('session-token-1'),
  }
}

function securityPolicy() {
  return {
    mfa: { mode: 'optional' as const },
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
    captcha: { enabled: false, provider: 'turnstile' as const, siteKey: '', secretBinding: '' },
    blocklist: { blockSubaddressing: false, entries: [] },
  }
}

function createPage() {
  return {
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
  }
}

function _requestWithFile(app: ReturnType<typeof createApp>) {
  const request = new Request('https://auth.example.com/api/account/avatar', {
    method: 'POST',
    headers: { 'x-user-id': 'user-1', 'x-user-role': 'user' },
  })
  Object.defineProperty(request, 'formData', {
    value: async () => ({
      get: (key: string) =>
        key === 'file'
          ? {
              name: 'avatar.png',
              type: 'image/png',
              size: 6,
              arrayBuffer: async () => new TextEncoder().encode('avatar').buffer,
            }
          : null,
    }),
  })
  return app.fetch(request)
}
