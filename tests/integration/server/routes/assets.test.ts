import { ApiError, notFound } from '@server/domain/errors'
import { handleApiError } from '@server/http/errors'
import { authContext } from '@server/http/middleware/auth-context'
import { createAccountAssetRoutes, createAssetRoutes, createManagementAssetRoutes } from '@server/http/routes/assets'
import * as assetsUsecase from '@server/usecases/assets'
import * as configzUsecase from '@server/usecases/configz'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../test-deps'

describe('asset routes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requires an authenticated account session before avatar uploads', async () => {
    const assets = createAssetServiceMock()
    const app = createRouteTestApp(assets)
    const response = await requestWithFile(app, '/api/account/avatar', {}, 'avatar.png', 'image/png', 'avatar')

    expect(response.status).toBe(401)
    expect(assets.upload).not.toHaveBeenCalled()
  })

  it('rejects upload requests without a file field', async () => {
    const assets = createAssetServiceMock()
    const app = createRouteTestApp(assets)
    const request = new Request('https://auth.example.com/api/account/avatar', {
      method: 'POST',
      headers: userHeaders(),
    })
    Object.defineProperty(request, 'formData', {
      value: async () => ({ get: () => null }),
    })

    const response = await app.fetch(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'bad_request', message: 'Upload file is required.' },
    })
    expect(assets.upload).not.toHaveBeenCalled()
  })

  it('uploads account avatars and updates the current user', async () => {
    const assets = createAssetServiceMock()
    const app = createRouteTestApp(assets)
    const response = await requestWithFile(
      app,
      '/api/account/avatar',
      userHeaders(),
      'avatar.png',
      'image/png',
      'avatar',
    )

    expect(response.status).toBe(201)
    expect(assets.upload).toHaveBeenCalledWith({
      purpose: 'avatar',
      file: expect.objectContaining({ name: 'avatar.png', type: 'image/png' }),
      actorUserId: 'user-1',
    })
    expect(assets.updateUserAvatar).toHaveBeenCalledWith('user-1', assetFixture())
  })

  it('uses default account-center settings for account avatar uploads without a config source', async () => {
    const assets = createAssetServiceMock()
    const deps = setupAssetMocks(assets)
    const app = new Hono()
      .use('/api/*', authContext(createAuthMock()))
      .use('/api/*', setDeps(deps))
      .onError((error, c) => {
        if (error instanceof ApiError) return handleApiError(error, c)
        throw error
      })
      .route('/api/account', createAccountAssetRoutes())
    const response = await requestWithFile(
      app,
      '/api/account/avatar',
      userHeaders(),
      'avatar.png',
      'image/png',
      'avatar',
    )

    expect(response.status).toBe(201)
    expect(assets.upload).toHaveBeenCalledWith({
      purpose: 'avatar',
      file: expect.objectContaining({ name: 'avatar.png', type: 'image/png' }),
      actorUserId: 'user-1',
    })
  })

  it('rejects account avatar uploads when account center avatar editing is disabled', async () => {
    const assets = createAssetServiceMock()
    const app = createRouteTestApp(assets, {
      profileEditingEnabled: true,
      avatarEditable: false,
    })
    const response = await requestWithFile(
      app,
      '/api/account/avatar',
      userHeaders(),
      'avatar.png',
      'image/png',
      'avatar',
    )

    expect(response.status).toBe(403)
    expect(assets.upload).not.toHaveBeenCalled()
    expect(assets.updateUserAvatar).not.toHaveBeenCalled()
  })

  it('rejects account avatar uploads when account center profile editing is disabled', async () => {
    const assets = createAssetServiceMock()
    const app = createRouteTestApp(assets, {
      profileEditingEnabled: false,
      avatarEditable: true,
    })
    const response = await requestWithFile(
      app,
      '/api/account/avatar',
      userHeaders(),
      'avatar.png',
      'image/png',
      'avatar',
    )

    expect(response.status).toBe(403)
    expect(assets.upload).not.toHaveBeenCalled()
    expect(assets.updateUserAvatar).not.toHaveBeenCalled()
  })

  it('reads account center config from deps when serving avatar uploads', async () => {
    const assets = createAssetServiceMock()
    const deps = setupAssetMocks(assets)
    const getConfig = configzUsecase.getConfig as unknown as ReturnType<typeof vi.fn>
    const app = new Hono()
      .use('/api/*', authContext(createAuthMock()))
      .use('/api/*', setDeps(deps))
      .onError((error, c) => {
        if (error instanceof ApiError) return handleApiError(error, c)
        throw error
      })
      .route('/api/account', createAccountAssetRoutes())
    const response = await requestWithFile(
      app,
      '/api/account/avatar',
      userHeaders(),
      'avatar.png',
      'image/png',
      'avatar',
      { DB: createD1Mock() },
    )

    expect(response.status).toBe(201)
    expect(getConfig).toHaveBeenCalled()
    expect(assets.upload).toHaveBeenCalled()
  })

  it('requires admin access for management uploads', async () => {
    const assets = createAssetServiceMock()
    const app = createRouteTestApp(assets)
    const response = await requestWithFile(
      app,
      '/api/management/applications/app-1/logo',
      userHeaders(),
      'logo.png',
      'image/png',
      'logo',
    )

    expect(response.status).toBe(403)
    expect(assets.upload).not.toHaveBeenCalled()
  })

  it('updates application, organization, branding, and favicon owners after admin uploads', async () => {
    const assets = createAssetServiceMock()
    const app = createRouteTestApp(assets)
    const headers = adminHeaders()

    await requestWithFile(app, '/api/management/applications/app-1/logo', headers, 'logo.png', 'image/png', 'logo')
    await requestWithFile(app, '/api/management/organizations/org-1/logo', headers, 'logo.png', 'image/png', 'logo')
    await requestWithFile(app, '/api/management/branding/logo', headers, 'logo.png', 'image/png', 'logo')
    await requestWithFile(app, '/api/management/branding/favicon', headers, 'favicon.png', 'image/png', 'icon')

    expect(assets.updateApplicationLogo).toHaveBeenCalledWith('app-1', assetFixture())
    expect(assets.updateOrganizationLogo).toHaveBeenCalledWith('org-1', assetFixture())
    expect(assets.updateBrandingAsset).toHaveBeenCalledWith('logo', assetFixture())
    expect(assets.updateBrandingAsset).toHaveBeenCalledWith('favicon', assetFixture())
  })

  it('serves stored R2 asset objects from the public asset route', async () => {
    const assets = createAssetServiceMock()
    const response = await createRouteTestApp(assets).request('/api/assets/asset-1')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('etag')).toBe('checksum-1')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    await expect(response.text()).resolves.toBe('asset-body')
  })
})

function createAssetServiceMock() {
  return {
    upload: vi.fn().mockResolvedValue({ asset: assetFixture() }),
    getObject: vi.fn().mockResolvedValue({
      asset: {
        ...assetFixture(),
        byteSize: 10,
        checksumSha256: 'checksum-1',
      },
      object: {
        body: 'asset-body',
      },
    }),
    updateUserAvatar: vi.fn().mockResolvedValue(undefined),
    updateApplicationLogo: vi.fn().mockResolvedValue(undefined),
    updateOrganizationLogo: vi.fn().mockResolvedValue(undefined),
    updateBrandingAsset: vi.fn().mockResolvedValue(undefined),
  }
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

function accountCenterFixture(overrides: Record<string, unknown> = {}) {
  return {
    profileEditingEnabled: true,
    displayNameEditable: true,
    usernameEditable: true,
    avatarEditable: true,
    emailChangeEnabled: true,
    passwordChangeEnabled: true,
    connectedAccountsEnabled: true,
    sessionsViewEnabled: true,
    dangerZoneEnabled: false,
    ...overrides,
  }
}

/**
 * Spies the asset usecase functions to delegate to the service mock and the
 * configz usecase to return the requested account-center settings. Returns the
 * Deps the routes read from context.
 */
function setupAssetMocks(
  assets: ReturnType<typeof createAssetServiceMock>,
  accountCenter: Record<string, unknown> = {},
) {
  vi.spyOn(assetsUsecase, 'uploadAsset').mockImplementation((_d, _origin, input) => assets.upload(input))
  vi.spyOn(assetsUsecase, 'getAssetObject').mockImplementation((_d, id) => assets.getObject(id))
  vi.spyOn(assetsUsecase, 'updateUserAvatar').mockImplementation((_d, userId, a) => assets.updateUserAvatar(userId, a))
  vi.spyOn(assetsUsecase, 'updateApplicationLogo').mockImplementation((_d, id, a) =>
    assets.updateApplicationLogo(id, a),
  )
  vi.spyOn(assetsUsecase, 'updateOrganizationLogo').mockImplementation((_d, id, a) =>
    assets.updateOrganizationLogo(id, a),
  )
  vi.spyOn(assetsUsecase, 'updateBrandingAsset').mockImplementation((_d, kind, a) =>
    assets.updateBrandingAsset(kind, a),
  )
  vi.spyOn(configzUsecase, 'getConfig').mockResolvedValue({
    accountCenter: accountCenterFixture(accountCenter),
  } as never)
  return createTestDeps()
}

function setDeps(deps: ReturnType<typeof createTestDeps>) {
  return async (c: { set: (key: 'deps', value: unknown) => void }, next: () => Promise<void>) => {
    c.set('deps', deps)
    await next()
  }
}

function createRouteTestApp(assets: ReturnType<typeof createAssetServiceMock>, accountCenter = {}) {
  const deps = setupAssetMocks(assets, accountCenter)
  return new Hono()
    .use('/api/*', authContext(createAuthMock()))
    .use('/api/*', setDeps(deps))
    .onError((error, c) => {
      if (error instanceof ApiError) return handleApiError(error, c)
      throw error
    })
    .notFound((c) => handleApiError(notFound(), c))
    .route('/api/assets', createAssetRoutes())
    .route('/api/account', createAccountAssetRoutes())
    .route('/api/management', createManagementAssetRoutes())
}

function requestWithFile(
  app: Hono,
  path: string,
  headers: Record<string, string>,
  filename: string,
  contentType: string,
  content: string,
  env?: object,
) {
  const request = new Request(`https://auth.example.com${path}`, { method: 'POST', headers })
  Object.defineProperty(request, 'formData', {
    value: async () => ({
      get: (key: string) =>
        key === 'file'
          ? {
              name: filename,
              type: contentType,
              size: content.length,
              arrayBuffer: async () => new TextEncoder().encode(content).buffer,
            }
          : null,
    }),
  })
  return app.fetch(request, env)
}

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

function adminHeaders() {
  return {
    'x-user-id': 'admin-1',
    'x-user-role': 'admin',
  }
}

function userHeaders() {
  return {
    'x-user-id': 'user-1',
    'x-user-role': 'user',
  }
}

function createD1Mock() {
  return {
    prepare: () => {
      throw new Error('Unexpected D1 query')
    },
  }
}
