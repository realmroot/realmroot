import { createApp } from '@server/http/app'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDeps } from '../test-deps'
import {
  adminHeaders,
  createAuthMock,
  createPage,
  createSecurityRepositoryMock,
  createUserRepositoryMock,
  managementSecurityPolicy,
  securityPolicy,
  updatedSecurityPolicy,
} from './management.test-utils'

describe('management routes 2', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('preserves existing admin-session auth behavior on management routes', async () => {
    const auth = createAuthMock()
    const users = createUserRepositoryMock()
    const response = await createApp(auth, createTestDeps({ users })).request(
      '/api/users?page=3&pageSize=10&banned=false',
      { headers: adminHeaders() },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [],
      pagination: { page: Math.floor(20 / 10) + 1, pageSize: 10, totalItems: 10, totalPages: Math.ceil(10 / 10) },
    })
    expect(users.listManagedUsers).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20, banned: false }),
      undefined,
    )
    expect(auth.api.getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      asResponse: false,
    })
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

    const weakPassword = await app.request('/api/users', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email: 'ada@example.com', displayName: 'Ada', password: 'Password1' }),
    })
    const blockedEmail = await app.request('/api/users', {
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
    const users = createUserRepositoryMock()
    vi.mocked(users.listManagedUsers).mockResolvedValueOnce({
      items: [{ id: 'user-1' } as never],
      total: 1,
      limit: 50,
      offset: 0,
    })
    const app = createApp(auth, createTestDeps({ users }))

    const managementResponse = await app.request('/api/users', { headers: adminHeaders() })

    await expect(managementResponse.json()).resolves.toEqual({
      items: [{ id: 'user-1' }],
      pagination: { page: Math.floor(0 / 50) + 1, pageSize: 50, totalItems: 1, totalPages: Math.ceil(1 / 50) },
    })
  })

  it('returns the Management error envelope for malformed application JSON', async () => {
    const response = await createApp(createAuthMock(), createTestDeps()).request('/api/applications', {
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
    const users = createUserRepositoryMock()
    const app = createApp(auth, createTestDeps({ users }))
    const headers = adminHeaders()

    await app.request('/api/users/user-1/password-reset-requests', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    })
    await app.request('/api/users/user-1/suspension', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ reason: 'abuse', expiresInSeconds: 3600 }),
    })
    await app.request('/api/users/user-1/suspension', { method: 'DELETE', headers })

    expect(auth.api.requestPasswordReset).toHaveBeenCalledWith({
      body: {
        email: 'ada@example.com',
        redirectTo: 'http://localhost/auth/forgot-password?mode=link',
      },
      headers: expect.any(Headers),
    })
    expect(users.suspendManagedUser).toHaveBeenCalledWith('user-1', 'abuse', expect.any(Date))
    expect(users.restoreManagedUser).toHaveBeenCalledWith('user-1')
  })

  it('aggregates management user detail and sub-collections without leaking unrelated lookups', async () => {
    const auth = createAuthMock()
    const users = createUserRepositoryMock()
    users.getUser = vi.fn().mockResolvedValue({ id: 'user-1', email: 'user-1@example.com' })
    users.listLinkedAccounts = vi.fn().mockImplementation((_userId, page) => Promise.resolve(createPage(page)))
    users.listSessions = vi.fn().mockImplementation((_userId, page) => Promise.resolve(createPage(page)))
    const app = createApp(auth, createTestDeps({ users }))
    const headers = adminHeaders()

    const detail = await app.request('/api/users/user-1', { headers })
    const accounts = await app.request('/api/users/user-1/linked-accounts?page=3&pageSize=2', { headers })
    const sessions = await app.request('/api/users/user-1/sessions?page=3&pageSize=4', { headers })
    const reset = await app.request('/api/users/user-1/password-reset-requests', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    })

    expect(detail.status).toBe(200)
    await expect(detail.json()).resolves.toMatchObject({
      user: { id: 'user-1', email: 'user-1@example.com' },
      security: { userId: 'user-1', mfa: { enabled: true } },
    })
    await expect(accounts.json()).resolves.toEqual({
      items: [],
      pagination: { page: Math.floor(4 / 2) + 1, pageSize: 2, totalItems: 10, totalPages: Math.ceil(10 / 2) },
    })
    await expect(sessions.json()).resolves.toEqual({
      items: [],
      pagination: { page: Math.floor(8 / 4) + 1, pageSize: 4, totalItems: 10, totalPages: Math.ceil(10 / 4) },
    })
    await expect(reset.json()).resolves.toMatchObject({ userId: 'user-1', status: 'accepted' })

    expect(auth.api.getUser).not.toHaveBeenCalled()
    expect(users.getUser).toHaveBeenCalledWith('user-1')
    expect(users.listLinkedAccounts).toHaveBeenCalledWith('user-1', { limit: 2, offset: 4 })
    expect(users.listSessions).toHaveBeenCalledWith('user-1', { limit: 4, offset: 8 })
    expect(auth.api.requestPasswordReset).toHaveBeenCalledWith({
      body: {
        email: 'user-1@example.com',
        redirectTo: 'http://localhost/auth/forgot-password?mode=link',
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

    const passkeys = await app.request('/api/users/user-1/passkeys?page=3&pageSize=2', { headers })
    const deleted = await app.request('/api/users/user-1/passkeys/passkey-1', {
      method: 'DELETE',
      headers,
    })

    await expect(passkeys.json()).resolves.toEqual({
      items: [
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
      pagination: { page: Math.floor(4 / 2) + 1, pageSize: 2, totalItems: 10, totalPages: Math.ceil(10 / 2) },
    })
    expect(deleted.status).toBe(204)
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
          customWords: ['realmroot'],
          rejectUserInfo: true,
          rejectSequential: true,
          rejectCustomWords: true,
        },
        captcha: {
          enabled: true,
          provider: 'turnstile',
          siteKey: 'site-key-1',
          projectId: null,
          secretKey: 'secret-1',
        },
        blocklist: {
          blockSubaddressing: true,
          entries: ['blocked@example.com', 'example.org'],
        },
      },
    }

    const current = await app.request('/api/realm/security-policy', { headers })
    const updated = await app.request('/api/realm/security-policy', {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    })

    expect(current.status).toBe(200)
    expect(updated.status).toBe(200)
    await expect(current.json()).resolves.toEqual({ policy: managementSecurityPolicy(securityPolicy()) })
    await expect(updated.json()).resolves.toEqual({ policy: managementSecurityPolicy(updatedSecurityPolicy()) })
    expect(security.getPolicy).toHaveBeenCalledTimes(2)
    expect(security.getSecurityState).toHaveBeenCalledWith('admin-1')
    expect(security.updatePolicy).toHaveBeenCalledWith(body)
  })

  it('updates and revokes specific managed users through the management boundary', async () => {
    const auth = createAuthMock()
    const users = createUserRepositoryMock()
    const app = createApp(auth, createTestDeps({ users }))
    const headers = adminHeaders()

    const updated = await app.request('/api/users/user-1', {
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
    const revokedOne = await app.request('/api/users/user-1/sessions/session-1', {
      method: 'DELETE',
      headers,
    })
    const revokedAll = await app.request('/api/users/user-1/sessions', {
      method: 'DELETE',
      headers,
    })

    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toEqual({ user: { id: 'user-1' } })
    expect(revokedOne.status).toBe(204)
    expect(revokedAll.status).toBe(204)

    expect(users.updateManagedUser).toHaveBeenCalledWith('user-1', {
      email: 'grace@example.com',
      emailVerified: false,
      displayName: 'Grace Hopper',
      username: 'grace',
    })
    expect(users.deleteSessions).toHaveBeenCalledWith('user-1', 'session-1')
    expect(users.deleteSessions).toHaveBeenCalledWith('user-1')
  })
})
