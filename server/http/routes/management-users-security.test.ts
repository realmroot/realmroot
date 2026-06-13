import { createApp } from '@server/http/app'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDeps } from '../test-deps'
import {
  adminHeaders,
  bearerHeaders,
  createAuthMock,
  createPage,
  createSecurityRepositoryMock,
  createUserRepositoryMock,
  securityPolicy,
  updatedSecurityPolicy,
} from './management.test-utils'

describe('management routes 2', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('does not promote Management permission strings without an admin role claim', async () => {
    const auth = createAuthMock()
    auth.api.oauth2UserInfo.mockResolvedValue({
      sub: 'user-1',
      email: 'user-1@example.com',
      client_id: 'flareauth-cli',
      scope: 'openid management:read',
      authorization: {
        permissions: ['management:write'],
      },
    })

    const response = await createApp(auth, createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/management/users',
      {
        headers: bearerHeaders('permissions-admin-token'),
      },
    )

    expect(response.status).toBe(403)
    expect(auth.api.listUsers).not.toHaveBeenCalled()
  })

  it('accepts Management Bearer tokens on management routes', async () => {
    const auth = createAuthMock()
    auth.api.oauth2UserInfo.mockResolvedValue({
      sub: 'admin-1',
      email: 'admin-1@example.com',
      role: 'admin',
      client_id: 'flareauth-cli',
      scope: 'openid management:read management:write',
    })

    const response = await createApp(auth, createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/management/users',
      {
        headers: bearerHeaders('valid-admin-token'),
      },
    )

    expect(response.status).toBe(200)
    expect(auth.api.oauth2UserInfo).toHaveBeenCalled()
  })

  it('preserves existing admin-session auth behavior on management routes', async () => {
    const auth = createAuthMock()
    const response = await createApp(auth, createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/management/users?limit=10&offset=20&banned=false',
      { headers: adminHeaders() },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      users: [],
      pagination: {
        limit: 10,
        offset: 20,
        total: 0,
        hasMore: false,
        nextOffset: null,
      },
    })
    expect(auth.api.listUsers).toHaveBeenCalledWith({
      query: expect.objectContaining({
        limit: 10,
        offset: 20,
        filterField: 'banned',
        filterValue: false,
      }),
      headers: expect.any(Headers),
    })
    expect(auth.api.getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      asResponse: false,
    })
    expect(auth.api.oauth2UserInfo).not.toHaveBeenCalled()
  })

  it('enforces managed password and blocklist policy for management user creation', async () => {
    const auth = createAuthMock()
    const policy = securityPolicy({
      password: {
        minLength: 12,
        requiredCharacterTypes: 3,
        customWords: [],
        rejectUserInfo: true,
        rejectSequential: true,
        rejectCustomWords: false,
      },
      blocklist: {
        blockSubaddressing: true,
        entries: ['blocked.example'],
      },
    })
    const app = createApp(
      auth,
      createTestDeps({
        users: createUserRepositoryMock(),
        security: createSecurityRepositoryMock(policy),
      }),
      { securityPolicy: policy },
    )

    const weakPassword = await app.request('/api/management/users', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email: 'ada@example.com', displayName: 'Ada', password: 'Password1' }),
    })
    const blockedEmail = await app.request('/api/management/users', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email: 'ada@blocked.example', displayName: 'Ada', password: 'Valid-pass-Zed!' }),
    })

    expect(weakPassword.status).toBe(400)
    await expect(weakPassword.json()).resolves.toMatchObject({
      error: { message: 'Password must be at least 12 characters.' },
    })
    expect(blockedEmail.status).toBe(400)
    await expect(blockedEmail.json()).resolves.toMatchObject({ error: { message: 'Email address is not allowed.' } })
    expect(auth.api.createUser).not.toHaveBeenCalled()
  })

  it('normalizes management user list pagination', async () => {
    const auth = createAuthMock()
    auth.api.listUsers.mockResolvedValueOnce({ users: [{ id: 'user-1' }], total: 1, limit: 50 })
    const app = createApp(auth, createTestDeps({ users: createUserRepositoryMock() }))

    const managementResponse = await app.request('/api/management/users', { headers: adminHeaders() })

    await expect(managementResponse.json()).resolves.toEqual({
      users: [{ id: 'user-1' }],
      pagination: {
        limit: 50,
        offset: 0,
        total: 1,
        hasMore: false,
        nextOffset: null,
      },
    })
  })

  it('returns the Management error envelope for malformed application JSON', async () => {
    const response = await createApp(createAuthMock(), createTestDeps()).request('/api/management/applications', {
      method: 'POST',
      headers: adminHeaders(),
      body: '{',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'bad_request',
        message: 'Invalid JSON body.',
      },
    })
  })

  it('supports REST-shaped management account action resources', async () => {
    const auth = createAuthMock()
    const app = createApp(auth, createTestDeps({ users: createUserRepositoryMock() }))
    const headers = adminHeaders()

    await app.request('/api/management/users/password-reset-requests', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'ada@example.com', redirectTo: 'https://app.example.com/reset' }),
    })
    await app.request('/api/management/users/user-1/ban', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ reason: 'abuse', expiresInSeconds: 3600 }),
    })
    await app.request('/api/management/users/user-1/ban', { method: 'DELETE', headers })

    expect(auth.api.requestPasswordReset).toHaveBeenCalledWith({
      body: {
        email: 'ada@example.com',
        redirectTo: 'https://app.example.com/reset',
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
  })

  it('aggregates management user detail and sub-collections without leaking unrelated lookups', async () => {
    const auth = createAuthMock()
    const users = createUserRepositoryMock()
    users.getUser = vi.fn().mockResolvedValue({ id: 'user-1', email: 'user-1@example.com' })
    users.listLinkedAccounts = vi.fn().mockImplementation((_userId, page) => Promise.resolve(createPage(page)))
    users.listConsentedApplications = vi.fn().mockImplementation((_userId, page) => Promise.resolve(createPage(page)))
    users.listSessions = vi.fn().mockImplementation((_userId, page) => Promise.resolve(createPage(page)))
    const app = createApp(auth, createTestDeps({ users }))
    const headers = adminHeaders()

    const detail = await app.request('/api/management/users/user-1', { headers })
    const accounts = await app.request('/api/management/users/user-1/linked-accounts?limit=2&offset=4', { headers })
    const applications = await app.request('/api/management/users/user-1/applications?limit=3&offset=6', { headers })
    const sessions = await app.request('/api/management/users/user-1/sessions?limit=4&offset=8', { headers })
    const reset = await app.request('/api/management/users/user-1/password-reset-requests', {
      method: 'POST',
      headers,
      body: JSON.stringify({ redirectTo: 'https://app.example.com/reset' }),
    })

    expect(detail.status).toBe(200)
    await expect(detail.json()).resolves.toEqual({ user: { id: 'user-1', email: 'user-1@example.com' } })
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
    await expect(reset.json()).resolves.toEqual({ status: true })

    expect(auth.api.getUser).not.toHaveBeenCalled()
    expect(users.getUser).toHaveBeenCalledWith('user-1')
    expect(users.listLinkedAccounts).toHaveBeenCalledWith('user-1', { limit: 2, offset: 4 })
    expect(users.listConsentedApplications).toHaveBeenCalledWith('user-1', { limit: 3, offset: 6 })
    expect(users.listSessions).toHaveBeenCalledWith('user-1', { limit: 4, offset: 8 })
    expect(auth.api.requestPasswordReset).toHaveBeenCalledWith({
      body: {
        email: 'user-1@example.com',
        redirectTo: 'https://app.example.com/reset',
      },
      headers: expect.any(Headers),
    })
  })

  it('exposes managed user security and passkey controls through safe repositories', async () => {
    const security = createSecurityRepositoryMock()
    const app = createApp(
      createAuthMock(),
      createTestDeps({
        users: createUserRepositoryMock(),
        security,
      }),
    )
    const headers = adminHeaders()

    const securityState = await app.request('/api/management/users/user-1/security', { headers })
    const passkeys = await app.request('/api/management/users/user-1/passkeys?limit=2&offset=4', { headers })
    const deleted = await app.request('/api/management/users/user-1/passkeys/passkey-1', {
      method: 'DELETE',
      headers,
    })

    expect(securityState.status).toBe(200)
    await expect(securityState.json()).resolves.toEqual({
      security: {
        userId: 'user-1',
        mfa: { enabled: true, factors: [] },
        passkeys: { enabled: true, count: 1 },
        policy: securityPolicy(),
      },
    })
    await expect(passkeys.json()).resolves.toEqual({
      passkeys: [
        {
          id: 'passkey-1',
          name: 'MacBook',
          userId: 'user-1',
          deviceType: 'platform',
          backedUp: true,
          transports: 'internal',
          createdAt: null,
          aaguid: null,
        },
      ],
      pagination: {
        limit: 2,
        offset: 4,
        total: 10,
        hasMore: true,
        nextOffset: 6,
      },
    })
    expect(deleted.status).toBe(204)
    expect(security.getSecurityState).toHaveBeenCalledWith('user-1')
    expect(security.listPasskeys).toHaveBeenCalledWith('user-1', { limit: 2, offset: 4 })
    expect(security.deletePasskey).toHaveBeenCalledWith('user-1', 'passkey-1')
  })

  it('reads and updates managed security policy through the management boundary', async () => {
    const security = createSecurityRepositoryMock()
    const app = createApp(
      createAuthMock(),
      createTestDeps({
        users: createUserRepositoryMock(),
        security,
      }),
      { securityPolicy: securityPolicy() },
    )
    const headers = adminHeaders()
    const body = {
      policy: {
        mfa: { mode: 'required' },
        password: {
          minLength: 14,
          requiredCharacterTypes: 3,
          customWords: ['flareauth'],
          rejectUserInfo: true,
          rejectSequential: true,
          rejectCustomWords: true,
        },
        captcha: {
          enabled: true,
          provider: 'turnstile',
          siteKey: 'site-key-1',
          secretBinding: 'TURNSTILE_SECRET',
        },
        blocklist: {
          blockSubaddressing: true,
          entries: ['blocked@example.com', 'example.org'],
        },
      },
    }

    const current = await app.request('/api/management/security/policy', { headers })
    const updated = await app.request('/api/management/security/policy', {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    })

    expect(current.status).toBe(200)
    expect(updated.status).toBe(200)
    await expect(current.json()).resolves.toEqual({ policy: securityPolicy() })
    await expect(updated.json()).resolves.toEqual({ policy: updatedSecurityPolicy() })
    expect(security.getPolicy).toHaveBeenCalledTimes(3)
    expect(security.updatePolicy).toHaveBeenCalledWith(body)
  })

  it('updates and revokes specific managed users through the management boundary', async () => {
    const auth = createAuthMock()
    const users = createUserRepositoryMock()
    const app = createApp(auth, createTestDeps({ users }))
    const headers = adminHeaders()

    const updated = await app.request('/api/management/users/user-1', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        email: 'grace@example.com',
        displayName: 'Grace Hopper',
        username: 'Grace',
        role: 'user',
        emailVerified: false,
      }),
    })
    const revokedOne = await app.request('/api/management/users/user-1/sessions/session-1', {
      method: 'DELETE',
      headers,
    })
    const revokedAll = await app.request('/api/management/users/user-1/sessions', {
      method: 'DELETE',
      headers,
    })

    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toEqual({ user: { id: 'user-1' } })
    await expect(revokedOne.json()).resolves.toEqual({ success: true })
    await expect(revokedAll.json()).resolves.toEqual({ success: true })

    expect(auth.api.adminUpdateUser).toHaveBeenCalledWith({
      body: {
        userId: 'user-1',
        data: {
          email: 'grace@example.com',
          emailVerified: false,
          name: 'Grace Hopper',
          username: 'grace',
          role: 'user',
        },
      },
      headers: expect.any(Headers),
    })
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
})
