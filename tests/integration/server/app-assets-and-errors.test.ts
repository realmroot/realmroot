import { createApp } from '@server/http/app'
import * as assets from '@server/usecases/assets'
import * as configz from '@server/usecases/configz'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDeps } from './test-deps'

type ConfigzConfig = Awaited<ReturnType<typeof configz.getConfig>>

function mockConfig() {
  return vi.spyOn(configz, 'getConfig').mockResolvedValue(configFixture() as ConfigzConfig)
}

function mockUpload() {
  const uploadAsset = vi.spyOn(assets, 'uploadAsset').mockResolvedValue({ asset: assetFixture() })
  const updateUserAvatar = vi.spyOn(assets, 'updateUserAvatar').mockResolvedValue(undefined)
  return { uploadAsset, updateUserAvatar }
}

function assetFixture() {
  return {
    id: 'asset-1',
    purpose: 'avatar' as const,
    publicUrl: 'https://auth.example.com/api/assets/asset-1',
    contentType: 'image/png',
    byteSize: 6,
    checksumSha256: 'checksum-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('app.test 3', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('mounts account avatar uploads with the injected account center config reader', async () => {
    const getConfig = mockConfig()
    const { uploadAsset } = mockUpload()
    const response = await requestWithFile(
      createApp(createAuthMock(), createTestDeps({ users: createUserRepositoryMock() })),
    )

    expect(response.status).toBe(201)
    expect(getConfig).toHaveBeenCalled()
    expect(uploadAsset).toHaveBeenCalledWith(expect.anything(), expect.any(String), {
      purpose: 'avatar',
      file: expect.objectContaining({ name: 'avatar.png', type: 'image/png' }),
      actorUserId: 'user-1',
    })
  })

  it('mounts RPC account avatar uploads with the injected account center config reader', async () => {
    const getConfig = mockConfig()
    const { uploadAsset } = mockUpload()
    const response = await requestWithFile(
      createApp(
        createAuthMock(),
        createTestDeps({
          users: createUserRepositoryMock(),
          security: createSecurityRepositoryMock(),
        }),
        { securityPolicy: securityPolicy() },
      ),
    )

    expect(response.status).toBe(201)
    expect(getConfig).toHaveBeenCalled()
    expect(uploadAsset).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ actorUserId: 'user-1' }),
    )
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

function _applicationCorsFactory(origins: string[]) {
  return () => ({
    list: vi.fn().mockResolvedValue({
      applications: [
        applicationResponse({ corsOrigins: origins }),
        applicationResponse({ disabled: true, corsOrigins: ['https://disabled.example.com'] }),
      ],
      pagination: { limit: 100, offset: 0, total: 2, hasMore: false, nextOffset: null },
    }),
    revokeConsent: vi.fn(),
  })
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

function _createWalletRepositoryMock({ linked }: { linked: boolean }) {
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

function createSecurityRepositoryMock() {
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

function requestWithFile(app: ReturnType<typeof createApp>) {
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
