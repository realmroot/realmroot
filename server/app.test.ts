import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import type { AssetService } from './modules/assets/service'

describe('createApp', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves health status', async () => {
    const auth = createAuthMock()
    const response = await createApp(auth).request('/api/health')

    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: 'flareauth',
    })
  })

  it('serves OAuth authorization server metadata at the issuer-path well-known route', async () => {
    const getOAuthServerConfig = vi.fn().mockResolvedValue({
      issuer: 'https://auth.example.com/api/auth',
      authorization_endpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
      token_endpoint: 'https://auth.example.com/api/auth/oauth2/token',
      jwks_uri: 'https://auth.example.com/api/auth/jwks',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    })
    const auth = {
      api: {
        getOAuthServerConfig,
        getOpenIdConfig: vi.fn(),
        getSession: vi.fn().mockResolvedValue(null),
      },
      handler: async () => new Response(null, { status: 204 }),
    }

    const response = await createApp(auth).request('/.well-known/oauth-authorization-server/api/auth')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      issuer: 'https://auth.example.com/api/auth',
      grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
      code_challenge_methods_supported: ['S256'],
    })
    expect(getOAuthServerConfig).toHaveBeenCalledWith({
      request: expect.any(Request),
      asResponse: false,
    })
  })

  it('returns consistent JSON errors from the boundary', async () => {
    const response = await createApp(createAuthMock()).request('/api/missing', {
      headers: {
        'cf-ray': 'request-1',
      },
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'not_found',
        message: 'Resource not found.',
        requestId: 'request-1',
      },
    })
  })

  it('rejects untrusted API origins before handlers run', async () => {
    const auth = createAuthMock()
    const response = await createApp(auth, { trustedOrigins: ['https://tenant.example.com'] }).request('/api/health', {
      headers: {
        origin: 'https://evil.example.com',
      },
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'forbidden',
        message: 'Origin is not trusted for this issuer.',
      },
    })
    expect(auth.api.getSession).not.toHaveBeenCalled()
  })

  it('allows trusted API origins and emits CORS response headers', async () => {
    const response = await createApp(createAuthMock(), { trustedOrigins: ['https://tenant.example.com'] }).request(
      '/api/health',
      {
        headers: {
          origin: 'https://tenant.example.com',
        },
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://tenant.example.com')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('mounts admin authorization routes behind the admin auth boundary', async () => {
    const app = createApp(createAuthMock())

    const organizations = await app.request('/api/admin/organizations')
    const resources = await app.request('/api/admin/api-resources')
    const roles = await app.request('/api/admin/roles')

    expect(organizations.status).toBe(401)
    expect(resources.status).toBe(401)
    expect(roles.status).toBe(401)
  })

  it('mounts account avatar uploads with the injected account center config reader', async () => {
    const configzService = createConfigzServiceMock()
    const assets = createAssetServiceMock()
    const response = await requestWithFile(
      createApp(createAuthMock(), {
        userRepository: createUserRepositoryMock(),
        assetServiceFactory: () => assets as unknown as AssetService,
        configzServiceFactory: () => configzService,
      }),
    )

    expect(response.status).toBe(201)
    expect(configzService.getConfig).toHaveBeenCalled()
    expect(assets.upload).toHaveBeenCalledWith({
      purpose: 'avatar',
      file: expect.objectContaining({ name: 'avatar.png', type: 'image/png' }),
      actorUserId: 'user-1',
    })
  })

  it('mounts RPC account avatar uploads with the injected account center config reader', async () => {
    const configzService = createConfigzServiceMock()
    const assets = createAssetServiceMock()
    const response = await requestWithFile(
      createApp(createAuthMock(), {
        userRepository: createUserRepositoryMock(),
        securityRepository: createSecurityRepositoryMock(),
        securityPolicy: securityPolicy(),
        assetServiceFactory: () => assets as unknown as AssetService,
        configzServiceFactory: () => configzService,
      }),
    )

    expect(response.status).toBe(201)
    expect(configzService.getConfig).toHaveBeenCalled()
    expect(assets.upload).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'user-1' }))
  })
})

function createAuthMock() {
  return {
    api: {
      getOAuthServerConfig: vi.fn(),
      getOpenIdConfig: vi.fn(),
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
    handler: async () => new Response(null, { status: 204 }),
  }
}

function createConfigzServiceMock() {
  return {
    getConfig: vi.fn().mockResolvedValue({
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
    }),
  }
}

function createAssetServiceMock() {
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
