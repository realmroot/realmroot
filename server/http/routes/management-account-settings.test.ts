import { createApp } from '@server/http/app'
import * as assets from '@server/usecases/assets'
import * as configz from '@server/usecases/configz'
import type { UserRepository } from '@server/usecases/ports'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDeps } from '../test-deps'

type ConfigzConfig = Awaited<ReturnType<typeof configz.getConfig>>

function mockConfig(config: Record<string, unknown>) {
  return vi.spyOn(configz, 'getConfig').mockResolvedValue(config as ConfigzConfig)
}

describe('management account settings routes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('enforces account center settings at the account API boundary', async () => {
    const auth = createAuthMock()
    const users = createUserRepositoryMock()
    mockConfig({
      accountCenter: {
        profileEditingEnabled: true,
        displayNameEditable: false,
        usernameEditable: false,
        avatarEditable: false,
        emailChangeEnabled: false,
        passwordChangeEnabled: false,
        connectedAccountsEnabled: false,
        sessionsViewEnabled: false,
        dangerZoneEnabled: false,
      },
    })
    const app = createApp(auth, createTestDeps({ users }))
    const headers = userHeaders()

    const profile = await app.request('/api/account/profile', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ displayName: 'Grace Hopper' }),
    })
    const email = await app.request('/api/account/email/change', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'grace@example.com' }),
    })
    const password = await app.request('/api/account/password/change', {
      method: 'POST',
      headers,
      body: JSON.stringify({ currentPassword: 'old-password', newPassword: 'new-password' }),
    })
    const linkedAccounts = await app.request('/api/account/linked-accounts', { headers })
    const applications = await app.request('/api/account/applications', { headers })
    const sessions = await app.request('/api/account/sessions', { headers })

    expect(profile.status).toBe(403)
    expect(email.status).toBe(403)
    expect(password.status).toBe(403)
    expect(linkedAccounts.status).toBe(403)
    expect(applications.status).toBe(403)
    expect(sessions.status).toBe(403)
    expect(users.updateProfile).not.toHaveBeenCalled()
    expect(auth.api.changeEmail).not.toHaveBeenCalled()
    expect(auth.api.changePassword).not.toHaveBeenCalled()
    expect(users.listLinkedAccounts).not.toHaveBeenCalled()
    expect(users.listConsentedApplications).not.toHaveBeenCalled()
    expect(users.listSessions).not.toHaveBeenCalled()
  })

  it('enforces account center username and avatar field permissions independently', async () => {
    const users = createUserRepositoryMock()
    mockConfig({
      accountCenter: {
        profileEditingEnabled: true,
        displayNameEditable: true,
        usernameEditable: false,
        avatarEditable: false,
        emailChangeEnabled: true,
        passwordChangeEnabled: true,
        connectedAccountsEnabled: true,
        sessionsViewEnabled: true,
        dangerZoneEnabled: false,
      },
    })
    const app = createApp(createAuthMock(), createTestDeps({ users }))

    const username = await app.request('/api/account/profile', {
      method: 'PATCH',
      headers: userHeaders(),
      body: JSON.stringify({ username: 'grace' }),
    })
    const avatar = await app.request('/api/account/profile', {
      method: 'PATCH',
      headers: userHeaders(),
      body: JSON.stringify({ avatarAssetId: 'asset-1' }),
    })

    expect(username.status).toBe(403)
    expect(avatar.status).toBe(403)
    expect(users.updateProfile).not.toHaveBeenCalled()
  })

  it('requires profile editing before allowing account email changes', async () => {
    const auth = createAuthMock()
    mockConfig({
      accountCenter: {
        profileEditingEnabled: false,
        displayNameEditable: true,
        usernameEditable: true,
        avatarEditable: true,
        emailChangeEnabled: true,
        passwordChangeEnabled: true,
        connectedAccountsEnabled: true,
        sessionsViewEnabled: true,
        dangerZoneEnabled: false,
      },
    })
    const response = await createApp(auth, createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/account/email/change',
      {
        method: 'POST',
        headers: userHeaders(),
        body: JSON.stringify({ email: 'grace@example.com' }),
      },
    )

    expect(response.status).toBe(403)
    expect(auth.api.changeEmail).not.toHaveBeenCalled()
  })

  it('mounts account avatar uploads with account-center config in the standard app', async () => {
    const uploadAsset = vi.spyOn(assets, 'uploadAsset').mockResolvedValue({ asset: assetFixture() })
    const updateUserAvatar = vi.spyOn(assets, 'updateUserAvatar').mockResolvedValue(undefined)
    mockConfig({
      accountCenter: {
        profileEditingEnabled: false,
        displayNameEditable: true,
        usernameEditable: true,
        avatarEditable: true,
        emailChangeEnabled: true,
        passwordChangeEnabled: true,
        connectedAccountsEnabled: true,
        sessionsViewEnabled: true,
        dangerZoneEnabled: false,
      },
    })
    const app = createApp(createAuthMock(), createTestDeps({ users: createUserRepositoryMock() }))

    const response = await requestWithFile(app, '/api/account/avatar', userHeaders())

    expect(response.status).toBe(403)
    expect(uploadAsset).not.toHaveBeenCalled()
    expect(updateUserAvatar).not.toHaveBeenCalled()
  })

  it('enforces individual account profile field permissions', async () => {
    const users = createUserRepositoryMock()
    mockConfig({
      accountCenter: {
        profileEditingEnabled: true,
        displayNameEditable: true,
        usernameEditable: false,
        avatarEditable: false,
        emailChangeEnabled: true,
        passwordChangeEnabled: true,
        connectedAccountsEnabled: true,
        sessionsViewEnabled: true,
        dangerZoneEnabled: false,
      },
    })
    const app = createApp(createAuthMock(), createTestDeps({ users }))
    const headers = userHeaders()

    const username = await app.request('/api/account/profile', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ username: 'grace' }),
    })
    const avatar = await app.request('/api/account/profile', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ avatarAssetId: 'asset-1' }),
    })

    expect(username.status).toBe(403)
    expect(avatar.status).toBe(403)
    expect(users.updateProfile).not.toHaveBeenCalled()
  })

  it('serves account read APIs from the current end-user session', async () => {
    const users = createUserRepositoryMock()
    const app = createApp(createAuthMock(), createTestDeps({ users }))
    const headers = userHeaders()

    await app.request('/api/account/profile', { headers })
    const accounts = await app.request('/api/account/linked-accounts?limit=2&offset=4', { headers })
    const applications = await app.request('/api/account/applications?limit=3&offset=6', { headers })
    const sessions = await app.request('/api/account/sessions?limit=4&offset=8', { headers })

    expect(users.getUser).toHaveBeenCalledWith('user-1')
    expect(users.listLinkedAccounts).toHaveBeenCalledWith('user-1', { limit: 2, offset: 4 })
    expect(users.listConsentedApplications).toHaveBeenCalledWith('user-1', { limit: 3, offset: 6 })
    expect(users.listSessions).toHaveBeenCalledWith('user-1', { limit: 4, offset: 8 })
    await expect(accounts.json()).resolves.toMatchObject({
      accounts: [],
      pagination: {
        limit: 2,
        offset: 4,
        total: 10,
        hasMore: true,
        nextOffset: 6,
      },
    })
    await expect(applications.json()).resolves.toMatchObject({
      applications: [],
      pagination: {
        limit: 3,
        offset: 6,
        total: 10,
        hasMore: true,
        nextOffset: 9,
      },
    })
    await expect(sessions.json()).resolves.toMatchObject({
      sessions: [],
      pagination: {
        limit: 4,
        offset: 8,
        total: 10,
        hasMore: false,
        nextOffset: null,
      },
    })
  })

  it('translates Better Auth API errors to the JSON error boundary', async () => {
    const auth = createAuthMock()
    auth.api.requestEmailChangeEmailOTP.mockRejectedValueOnce({
      statusCode: 404,
      body: { message: 'User not found.' },
      message: 'User not found.',
    })

    const response = await createApp(auth, createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/account/email/change',
      {
        method: 'POST',
        headers: userHeaders(),
        body: JSON.stringify({ email: 'missing@example.com' }),
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'not_found',
        message: 'User not found.',
      },
    })
  })

  it('validates account profile updates only at the request boundary', async () => {
    const auth = createAuthMock()
    const users = createUserRepositoryMock()
    const response = await createApp(auth, createTestDeps({ users })).request('/api/account/profile', {
      method: 'PATCH',
      headers: userHeaders(),
      body: JSON.stringify({ username: 'no spaces' }),
    })

    expect(response.status).toBe(400)
    expect(users.updateProfile).not.toHaveBeenCalled()
  })

  it('validates connector configuration before management route persistence', async () => {
    const deps = createTestDeps({ users: createUserRepositoryMock() })
    const response = await createApp(createAuthMock(), deps).request('/api/management/connectors', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        providerType: 'generic_oauth',
        providerId: 'okta-main',
        displayName: 'Okta',
        clientId: 'client-id',
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining('clientSecret is required.'),
      },
    })
    expect(deps.connectors.create).not.toHaveBeenCalled()
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

function requestWithFile(app: ReturnType<typeof createApp>, path: string, headers: Record<string, string>) {
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
