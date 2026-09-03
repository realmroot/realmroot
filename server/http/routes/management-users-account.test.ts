import { createApp } from '@server/http/app'
import type { UserRepository } from '@server/usecases/ports'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../test-deps'

describe('management users and account routes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('returns an empty tenant-filtered user collection to users without Organization memberships', async () => {
    const auth = createAuthMock()
    const response = await createApp(auth, createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/users',
      {
        headers: {
          'x-user-id': 'user-1',
          'x-user-role': 'user',
        },
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ items: [] })
    expect(auth.api.listUsers).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated admin and account requests', async () => {
    const auth = createAuthMock()
    const app = createApp(auth, createTestDeps({ users: createUserRepositoryMock() }))

    const adminResponse = await app.request('/api/users')
    const accountResponse = await app.request('/api/account/profile')

    expect(adminResponse.status).toBe(401)
    expect(accountResponse.status).toBe(401)
  })

  it('delegates managed user CRUD to the repository and password reset delivery to Better Auth', async () => {
    const auth = createAuthMock()
    const users = createUserRepositoryMock()
    const app = createApp(auth, createTestDeps({ users }))
    const headers = adminHeaders()

    await app.request('/api/users?search=ada&searchField=email&pageSize=10&role=user', { headers })
    await app.request('/api/users', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'ada@example.com',
        password: 'password-1',
        displayName: 'Ada Lovelace',
        username: 'Ada',
        avatarAssetId: 'asset-1',
        role: 'user',
      }),
    })
    await app.request('/api/users/user-1', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        displayName: 'Ada',
        emailVerified: true,
      }),
    })
    await app.request('/api/users/user-1/suspension', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        reason: 'abuse',
        expiresInSeconds: 3600,
      }),
    })
    await app.request('/api/users/user-1/suspension', { method: 'DELETE', headers })
    await app.request('/api/users/user-1', { method: 'DELETE', headers })
    await app.request('/api/users/user-1/password-reset-requests', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    })

    expect(users.listManagedUsers).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'ada', searchField: 'email', limit: 10 }),
      undefined,
    )
    expect(users.assertAdminAvatarReference).toHaveBeenCalledWith('asset-1')
    expect(users.createManagedUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ada@example.com',
        displayName: 'Ada Lovelace',
        username: 'ada',
        avatarAssetId: 'asset-1',
      }),
    )
    expect(users.updateManagedUser).toHaveBeenCalledWith('user-1', {
      displayName: 'Ada',
      emailVerified: true,
    })
    expect(users.suspendManagedUser).toHaveBeenCalledWith('user-1', 'abuse', expect.any(Date))
    expect(users.restoreManagedUser).toHaveBeenCalledWith('user-1')
    expect(users.deleteManagedUser).toHaveBeenCalledWith('user-1')
    expect(auth.api.requestPasswordReset).toHaveBeenCalledWith({
      body: {
        email: 'ada@example.com',
        redirectTo: 'http://localhost/auth/forgot-password?mode=link',
      },
      headers: expect.any(Headers),
    })
  })

  it('parses banned=false as a false admin list filter', async () => {
    const auth = createAuthMock()
    const users = createUserRepositoryMock()

    await createApp(auth, createTestDeps({ users })).request('/api/users?banned=false', {
      headers: adminHeaders(),
    })

    expect(users.listManagedUsers).toHaveBeenCalledWith(expect.objectContaining({ banned: false }), undefined)
  })

  it('aggregates admin user detail resources', async () => {
    const auth = createAuthMock()
    const users = createUserRepositoryMock()
    const response = await createApp(auth, createTestDeps({ users })).request('/api/users/user-1', {
      headers: adminHeaders(),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      user: { id: 'user-1', email: 'ada@example.com' },
      security: { userId: 'user-1', mfa: { enabled: true } },
    })
    expect(users.getUser).toHaveBeenCalledWith('user-1')
    expect(auth.api.getUser).not.toHaveBeenCalled()
    expect(users.listLinkedAccounts).not.toHaveBeenCalled()
    expect(users.listSessions).not.toHaveBeenCalled()
  })

  it('serves admin user sub-collections with pagination metadata', async () => {
    const users = createUserRepositoryMock()
    const app = createApp(createAuthMock(), createTestDeps({ users }))
    const headers = adminHeaders()

    const accounts = await app.request('/api/users/user-1/linked-accounts?page=3&pageSize=2', { headers })
    const sessions = await app.request('/api/users/user-1/sessions?page=3&pageSize=4', { headers })

    await expect(accounts.json()).resolves.toEqual({
      items: [],
      pagination: { page: Math.floor(4 / 2) + 1, pageSize: 2, totalItems: 10, totalPages: Math.ceil(10 / 2) },
    })
    await expect(sessions.json()).resolves.toEqual({
      items: [],
      pagination: { page: Math.floor(8 / 4) + 1, pageSize: 4, totalItems: 10, totalPages: Math.ceil(10 / 4) },
    })
    expect(users.listLinkedAccounts).toHaveBeenCalledWith('user-1', { limit: 2, offset: 4 })
    expect(users.listSessions).toHaveBeenCalledWith('user-1', { limit: 4, offset: 8 })
  })

  it('lists and revokes admin-visible user sessions through the repository', async () => {
    const auth = createAuthMock()
    const users = createUserRepositoryMock()
    const app = createApp(auth, createTestDeps({ users }))

    await app.request('/api/users/user-1/sessions', { headers: adminHeaders() })
    await app.request('/api/users/user-1/sessions', { method: 'DELETE', headers: adminHeaders() })
    await app.request('/api/users/user-1/sessions/session-1', { method: 'DELETE', headers: adminHeaders() })

    expect(users.listSessions).toHaveBeenCalledWith('user-1', { limit: 50, offset: 0 })
    expect(users.deleteSessions).toHaveBeenCalledWith('user-1')
    expect(users.deleteSessions).toHaveBeenCalledWith('user-1', 'session-1')
  })

  it('updates account profile at the request boundary and delegates email and password flows [spec: account-center/email-update] [spec: account-center/password-update]', async () => {
    const auth = createAuthMock()
    auth.api.changePassword.mockResolvedValueOnce(
      Response.json(
        { token: 'replacement-session' },
        { headers: { 'set-cookie': 'better-auth.session_token=replacement-session; Path=/; HttpOnly' } },
      ),
    )
    const users = createUserRepositoryMock()
    const app = createApp(auth, createTestDeps({ users }))
    const headers = userHeaders()

    await app.request('/api/account/profile', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        displayName: 'Grace Hopper',
        username: 'Grace',
        avatarAssetId: 'asset-2',
      }),
    })
    await app.request('/api/account/email/change', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'grace@example.com' }),
    })
    await app.request('/api/account/email/confirm', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'grace@example.com', otp: '123456' }),
    })
    await app.request('/api/account/email/verification', { method: 'POST', headers })
    const passwordResponse = await app.request('/api/account/password/change', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        currentPassword: 'old-password',
        newPassword: 'new-password',
        revokeOtherSessions: true,
      }),
    })
    await app.request('/api/account/linked-accounts', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        providerType: 'social',
        providerId: 'google',
        callbackURL: '/account/linked-accounts',
        scopes: ['openid', 'email'],
      }),
    })
    await app.request('/api/account/linked-accounts', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        providerType: 'generic_oauth',
        providerId: 'okta-main',
        callbackURL: '/account/linked-accounts',
      }),
    })
    await app.request('/api/account/linked-accounts/google?accountId=google-account-1', { method: 'DELETE', headers })

    expect(users.updateProfile).toHaveBeenCalledWith('user-1', {
      displayName: 'Grace Hopper',
      username: 'grace',
      avatarAssetId: 'asset-2',
    })
    expect(auth.api.requestEmailChangeEmailOTP).toHaveBeenCalledWith({
      body: {
        newEmail: 'grace@example.com',
      },
      headers: expect.any(Headers),
    })
    expect(auth.api.changeEmailEmailOTP).toHaveBeenCalledWith({
      body: {
        newEmail: 'grace@example.com',
        otp: '123456',
      },
      headers: expect.any(Headers),
    })
    expect(auth.api.sendVerificationEmail).toHaveBeenCalledWith({
      body: { email: 'user-1@example.com' },
      headers: expect.any(Headers),
    })
    expect(auth.api.changePassword).toHaveBeenCalledWith({
      asResponse: true,
      body: {
        currentPassword: 'old-password',
        newPassword: 'new-password',
        revokeOtherSessions: true,
      },
      headers: expect.any(Headers),
    })
    expect(passwordResponse.headers.get('set-cookie')).toContain('replacement-session')
    expect(auth.api.linkSocialAccount).toHaveBeenCalledWith({
      body: {
        provider: 'google',
        callbackURL: '/account/linked-accounts',
        errorCallbackURL: undefined,
        scopes: ['openid', 'email'],
      },
      headers: expect.any(Headers),
    })
    expect(auth.api.oAuth2LinkAccount).toHaveBeenCalledWith({
      body: {
        providerId: 'okta-main',
        callbackURL: '/account/linked-accounts',
        errorCallbackURL: undefined,
        scopes: undefined,
      },
      headers: expect.any(Headers),
    })
    expect(auth.api.unlinkAccount).toHaveBeenCalledWith({
      body: {
        providerId: 'google',
        accountId: 'google-account-1',
      },
      headers: expect.any(Headers),
    })
  })
})

function createAuthMock() {
  return {
    api: {
      getOAuthServerConfig: vi.fn(),
      getOpenIdConfig: vi.fn(),
      getSession: vi.fn().mockImplementation(({ headers }: { headers: Headers }) => {
        const id = headers.get('x-user-id')

        if (!id) {
          return null
        }

        return {
          session: { id: 'session-1' },
          user: {
            id,
            email: `${id}@example.com`,
            role: headers.get('x-user-role'),
          },
        }
      }),
      listUsers: vi.fn().mockResolvedValue({ users: [], total: 0 }),
      getUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
      createUser: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }),
      adminUpdateUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
      banUser: vi.fn().mockResolvedValue({ user: { id: 'user-1', banned: true } }),
      unbanUser: vi.fn().mockResolvedValue({ user: { id: 'user-1', banned: false } }),
      removeUser: vi.fn().mockResolvedValue({ success: true }),
      listUserSessions: vi.fn().mockResolvedValue({ sessions: [] }),
      revokeUserSession: vi.fn().mockResolvedValue({ success: true }),
      revokeUserSessions: vi.fn().mockResolvedValue({ success: true }),
      requestPasswordReset: vi.fn().mockResolvedValue({ success: true }),
      sendVerificationEmail: vi.fn().mockResolvedValue({ status: true }),
      changeEmail: vi.fn().mockResolvedValue({ status: true }),
      requestEmailChangeEmailOTP: vi.fn().mockResolvedValue({ success: true }),
      changeEmailEmailOTP: vi.fn().mockResolvedValue({ success: true }),
      changePassword: vi.fn().mockResolvedValue(Response.json({ status: true })),
      linkSocialAccount: vi.fn().mockResolvedValue({ url: 'https://accounts.example.com/oauth', redirect: true }),
      oAuth2LinkAccount: vi.fn().mockResolvedValue({ url: 'https://idp.example.com/oauth', redirect: true }),
      unlinkAccount: vi.fn().mockResolvedValue({ status: true }),
    },
    handler: async () => new Response(null, { status: 204 }),
  }
}

function createUserRepositoryMock(): UserRepository {
  return {
    getUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'ada@example.com' }),
    getPublicProfile: vi.fn().mockResolvedValue({
      user: { id: 'user-1', email: 'ada@example.com' },
      bio: null,
      location: null,
      links: [],
      profileUpdatedAt: null,
    }),
    findPublicProfileByUsername: vi.fn().mockResolvedValue(null),
    listManagedUsers: vi.fn().mockImplementation((page) => Promise.resolve(createPage(page))),
    createManagedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    updateManagedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    suspendManagedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    restoreManagedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    deleteManagedUser: vi.fn().mockResolvedValue(undefined),
    updateProfile: vi.fn().mockResolvedValue({ id: 'user-1' }),
    assertAccountAvatarReference: vi.fn().mockResolvedValue(undefined),
    assertAdminAvatarReference: vi.fn().mockResolvedValue(undefined),
    listLinkedAccounts: vi.fn().mockImplementation((_userId, page) => Promise.resolve(createPage(page))),
    listSessions: vi.fn().mockImplementation((_userId, page) => Promise.resolve(createPage(page))),
    getSessionToken: vi.fn().mockResolvedValue('session-token-1'),
    deleteSessions: vi.fn().mockResolvedValue([{ id: 'session-1' }]),
    createPasswordResetRequest: vi.fn().mockImplementation(async (input) => input),
    findPasswordResetRequest: vi.fn().mockResolvedValue(null),
  }
}

function createPage(page: { limit: number; offset: number }) {
  return {
    items: [],
    total: 10,
    ...page,
  }
}

function _assetFixture() {
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

function _requestWithFile(app: ReturnType<typeof createApp>, path: string, headers: Record<string, string>) {
  const request = new Request(`https://auth.example.com${path}`, { method: 'POST', headers })
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

function adminHeaders() {
  return {
    'content-type': 'application/json',
    'x-user-id': 'admin-1',
    'x-user-role': 'admin',
  }
}

function userHeaders() {
  return {
    'content-type': 'application/json',
    'x-user-id': 'user-1',
    'x-user-role': 'user',
  }
}
