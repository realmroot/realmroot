import { createApp } from '@server/http/app'
import type { UserRepository } from '@server/usecases/ports'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../test-deps'

describe('management users and account routes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('rejects normal users from admin user APIs', async () => {
    const auth = createAuthMock()
    const response = await createApp(auth, createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/management/users',
      {
        headers: {
          'x-user-id': 'user-1',
          'x-user-role': 'user',
        },
      },
    )

    expect(response.status).toBe(403)
    expect(auth.api.listUsers).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated admin and account requests', async () => {
    const auth = createAuthMock()
    const app = createApp(auth, createTestDeps({ users: createUserRepositoryMock() }))

    const adminResponse = await app.request('/api/management/users')
    const accountResponse = await app.request('/api/account/profile')

    expect(adminResponse.status).toBe(401)
    expect(accountResponse.status).toBe(401)
  })

  it('delegates admin user CRUD and password reset to Better Auth admin APIs', async () => {
    const auth = createAuthMock()
    const users = createUserRepositoryMock()
    const app = createApp(auth, createTestDeps({ users }))
    const headers = adminHeaders()

    await app.request('/api/management/users?search=ada&searchField=email&limit=10&role=user', { headers })
    await app.request('/api/management/users', {
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
    await app.request('/api/management/users/user-1', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        displayName: 'Ada',
        emailVerified: true,
      }),
    })
    await app.request('/api/management/users/user-1/ban', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reason: 'abuse',
        expiresInSeconds: 3600,
      }),
    })
    await app.request('/api/management/users/user-1/unban', { method: 'POST', headers })
    await app.request('/api/management/users/user-1', { method: 'DELETE', headers })
    await app.request('/api/management/users/password-reset', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'ada@example.com' }),
    })

    expect(auth.api.listUsers).toHaveBeenCalledWith({
      query: expect.objectContaining({
        searchValue: 'ada',
        searchField: 'email',
        limit: 10,
        filterField: 'role',
        filterValue: 'user',
      }),
      headers: expect.any(Headers),
    })
    expect(users.assertAdminAvatarReference).toHaveBeenCalledWith('asset-1')
    expect(auth.api.createUser).toHaveBeenCalledWith({
      body: expect.objectContaining({
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        data: {
          username: 'ada',
          avatarAssetId: 'asset-1',
        },
      }),
      headers: expect.any(Headers),
    })
    expect(auth.api.adminUpdateUser).toHaveBeenCalledWith({
      body: {
        userId: 'user-1',
        data: {
          emailVerified: true,
          name: 'Ada',
        },
      },
      headers: expect.any(Headers),
    })
    expect(auth.api.banUser).toHaveBeenCalledWith({
      body: {
        userId: 'user-1',
        banReason: 'abuse',
        banExpiresIn: 3600,
      },
      headers: expect.any(Headers),
    })
    expect(auth.api.unbanUser).toHaveBeenCalledWith({ body: { userId: 'user-1' }, headers: expect.any(Headers) })
    expect(auth.api.removeUser).toHaveBeenCalledWith({ body: { userId: 'user-1' }, headers: expect.any(Headers) })
    expect(auth.api.requestPasswordReset).toHaveBeenCalledWith({
      body: {
        email: 'ada@example.com',
        redirectTo: undefined,
      },
      headers: expect.any(Headers),
    })
  })

  it('parses banned=false as a false admin list filter', async () => {
    const auth = createAuthMock()

    await createApp(auth, createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/management/users?banned=false',
      {
        headers: adminHeaders(),
      },
    )

    expect(auth.api.listUsers).toHaveBeenCalledWith({
      query: expect.objectContaining({
        filterField: 'banned',
        filterValue: false,
      }),
      headers: expect.any(Headers),
    })
  })

  it('aggregates admin user detail resources', async () => {
    const auth = createAuthMock()
    const users = createUserRepositoryMock()
    const response = await createApp(auth, createTestDeps({ users })).request('/api/management/users/user-1', {
      headers: adminHeaders(),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      user: { id: 'user-1' },
    })
    expect(users.getUser).toHaveBeenCalledWith('user-1')
    expect(auth.api.getUser).not.toHaveBeenCalled()
    expect(users.listLinkedAccounts).not.toHaveBeenCalled()
    expect(users.listConsentedApplications).not.toHaveBeenCalled()
    expect(users.listSessions).not.toHaveBeenCalled()
  })

  it('serves admin user sub-collections with pagination metadata', async () => {
    const users = createUserRepositoryMock()
    const app = createApp(createAuthMock(), createTestDeps({ users }))
    const headers = adminHeaders()

    const accounts = await app.request('/api/management/users/user-1/linked-accounts?limit=2&offset=4', { headers })
    const applications = await app.request('/api/management/users/user-1/applications?limit=3&offset=6', { headers })
    const sessions = await app.request('/api/management/users/user-1/sessions?limit=4&offset=8', { headers })

    await expect(accounts.json()).resolves.toEqual({
      accounts: [],
      pagination: {
        limit: 2,
        offset: 4,
        total: 10,
        hasMore: true,
        nextOffset: 6,
      },
    })
    await expect(applications.json()).resolves.toEqual({
      applications: [],
      pagination: {
        limit: 3,
        offset: 6,
        total: 10,
        hasMore: true,
        nextOffset: 9,
      },
    })
    await expect(sessions.json()).resolves.toEqual({
      sessions: [],
      pagination: {
        limit: 4,
        offset: 8,
        total: 10,
        hasMore: false,
        nextOffset: null,
      },
    })
    expect(users.listLinkedAccounts).toHaveBeenCalledWith('user-1', { limit: 2, offset: 4 })
    expect(users.listConsentedApplications).toHaveBeenCalledWith('user-1', { limit: 3, offset: 6 })
    expect(users.listSessions).toHaveBeenCalledWith('user-1', { limit: 4, offset: 8 })
  })

  it('lists and revokes admin-visible user sessions without exposing token lookup in the route', async () => {
    const auth = createAuthMock()
    const users = createUserRepositoryMock()
    const app = createApp(auth, createTestDeps({ users }))

    await app.request('/api/management/users/user-1/sessions', { headers: adminHeaders() })
    await app.request('/api/management/users/user-1/sessions', { method: 'DELETE', headers: adminHeaders() })
    await app.request('/api/management/users/user-1/sessions/session-1', { method: 'DELETE', headers: adminHeaders() })

    expect(auth.api.listUserSessions).not.toHaveBeenCalled()
    expect(users.listSessions).toHaveBeenCalledWith('user-1', { limit: 50, offset: 0 })
    expect(users.getSessionToken).toHaveBeenCalledWith('user-1', 'session-1')
    expect(auth.api.revokeUserSession).toHaveBeenCalledWith({
      body: { sessionToken: 'session-token-1' },
      headers: expect.any(Headers),
    })
    expect(auth.api.revokeUserSessions).toHaveBeenCalledWith({
      body: { userId: 'user-1' },
      headers: expect.any(Headers),
    })
  })

  it('updates account profile at the request boundary and delegates email and password flows [spec: account-center/email-update] [spec: account-center/password-update] [spec: account-center/linked-account-unlink]', async () => {
    const auth = createAuthMock()
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
    await app.request('/api/account/password/change', {
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
      body: {
        currentPassword: 'old-password',
        newPassword: 'new-password',
        revokeOtherSessions: true,
      },
      headers: expect.any(Headers),
    })
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
      requestPasswordReset: vi.fn().mockResolvedValue({ status: true }),
      sendVerificationEmail: vi.fn().mockResolvedValue({ status: true }),
      changeEmail: vi.fn().mockResolvedValue({ status: true }),
      requestEmailChangeEmailOTP: vi.fn().mockResolvedValue({ success: true }),
      changeEmailEmailOTP: vi.fn().mockResolvedValue({ success: true }),
      changePassword: vi.fn().mockResolvedValue({ status: true }),
      linkSocialAccount: vi.fn().mockResolvedValue({ url: 'https://accounts.example.com/oauth', redirect: true }),
      oAuth2LinkAccount: vi.fn().mockResolvedValue({ url: 'https://idp.example.com/oauth', redirect: true }),
      unlinkAccount: vi.fn().mockResolvedValue({ status: true }),
    },
    handler: async () => new Response(null, { status: 204 }),
  }
}

function createUserRepositoryMock(): UserRepository {
  return {
    getUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    listManagedUsers: vi.fn().mockImplementation((page) => Promise.resolve(createPage(page))),
    createManagedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    updateManagedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    deleteManagedUser: vi.fn().mockResolvedValue(undefined),
    updateProfile: vi.fn().mockResolvedValue({ id: 'user-1' }),
    assertAccountAvatarReference: vi.fn().mockResolvedValue(undefined),
    assertAdminAvatarReference: vi.fn().mockResolvedValue(undefined),
    listLinkedAccounts: vi.fn().mockImplementation((_userId, page) => Promise.resolve(createPage(page))),
    listConsentedApplications: vi.fn().mockImplementation((_userId, page) => Promise.resolve(createPage(page))),
    listSessions: vi.fn().mockImplementation((_userId, page) => Promise.resolve(createPage(page))),
    getSessionToken: vi.fn().mockResolvedValue('session-token-1'),
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
