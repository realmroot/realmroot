import { createApp } from '@server/http/app'
import * as configz from '@server/usecases/configz'
import type { SecurityRepository, UserRepository } from '@server/usecases/ports'
import type { SecurityPolicy } from '@shared/api/security'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDeps } from '../test-deps'

describe('account security passkey routes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves account security state and delegates MFA enrollment APIs to Better Auth [spec: account-center/totp-flow]', async () => {
    const auth = createAuthMock()
    const security = createSecurityRepositoryMock(securityPolicy({ mfa: { mode: 'required' } }))
    const app = createApp(auth, createTestDeps({ users: createUserRepositoryMock(), security }), {
      securityPolicy: securityPolicy(),
    })
    const headers = userHeaders()

    const state = await app.request('/api/account/security', { headers })
    const mfa = await app.request('/api/account/security/mfa/totp-enrollment', {
      method: 'POST',
      headers,
      body: JSON.stringify({ password: 'password-1' }),
    })
    await app.request('/api/account/security/mfa/totp-verification', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: '123456', trustDevice: true }),
    })
    expect(state.status).toBe(200)
    await expect(state.json()).resolves.toMatchObject({
      security: {
        userId: 'user-1',
        mfa: {
          enabled: true,
        },
        passkeys: {
          enabled: true,
          count: 1,
        },
      },
    })
    expect(mfa.status).toBe(201)
    expect(auth.api.enableTwoFactor).toHaveBeenCalledWith({
      body: { password: 'password-1' },
      headers: expect.any(Headers),
    })
    expect(auth.api.verifyTOTP).toHaveBeenCalledWith({
      body: { code: '123456', trustDevice: true },
      headers: expect.any(Headers),
    })
  })

  it('serves account MFA/passkey resources and delegates backup code and passkey management [spec: account-center/passkey-flow]', async () => {
    const auth = createAuthMock()
    const security = createSecurityRepositoryMock()
    const app = createApp(auth, createTestDeps({ users: createUserRepositoryMock(), security }), {
      securityPolicy: securityPolicy(),
    })
    const headers = userHeaders()

    const mfa = await app.request('/api/account/security/mfa', { headers })
    const backupCodes = await app.request('/api/account/security/mfa/backup-codes', {
      method: 'POST',
      headers,
      body: JSON.stringify({ password: 'password-1' }),
    })
    const passkeys = await app.request('/api/account/security/passkeys?limit=3&offset=6', { headers })
    await app.request('/api/account/security/passkeys/passkey-1', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Laptop key' }),
    })
    await app.request('/api/account/security/passkeys/passkey-1', { method: 'DELETE', headers })

    await expect(mfa.json()).resolves.toMatchObject({
      mfa: { enabled: true },
      policy: { mode: 'optional' },
    })
    expect(backupCodes.status).toBe(201)
    await expect(passkeys.json()).resolves.toEqual({
      passkeys: [],
      policy: securityPolicy().passkeys,
      pagination: {
        limit: 3,
        offset: 6,
        total: 10,
        hasMore: true,
        nextOffset: 9,
      },
    })
    expect(auth.api.generateBackupCodes).toHaveBeenCalledWith({
      body: { password: 'password-1' },
      headers: expect.any(Headers),
    })
    expect(auth.api.updatePasskey).toHaveBeenCalledWith({
      body: { id: 'passkey-1', name: 'Laptop key' },
      headers: expect.any(Headers),
    })
    expect(auth.api.deletePasskey).toHaveBeenCalledWith({
      body: { id: 'passkey-1' },
      headers: expect.any(Headers),
    })
    expect(security.listPasskeys).toHaveBeenCalledWith('user-1', { limit: 3, offset: 6 })
  })

  it('blocks authenticator app enrollment when the factor is disabled by policy', async () => {
    const auth = createAuthMock()
    const security = createSecurityRepositoryMock(
      securityPolicy({
        mfa: {
          mode: 'optional',
          authenticatorAppEnabled: false,
          emailOtpEnabled: false,
          backupCodesEnabled: true,
        },
      }),
    )
    const app = createApp(auth, createTestDeps({ users: createUserRepositoryMock(), security }), {
      securityPolicy: securityPolicy(),
    })

    const response = await app.request('/api/account/security/mfa/totp-enrollment', {
      method: 'POST',
      headers: userHeaders(),
      body: JSON.stringify({ password: 'password-1' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { message: 'Authenticator app MFA is disabled for this deployment.' },
    })
    expect(auth.api.enableTwoFactor).not.toHaveBeenCalled()
  })

  it('revokes account sessions by resolving the user-owned session token [spec: account-center/session-revocation]', async () => {
    const auth = createAuthMock()
    const security = createSecurityRepositoryMock()
    const users = createUserRepositoryMock()
    const app = createApp(auth, createTestDeps({ users, security }), {
      securityPolicy: securityPolicy(),
    })

    const sessions = await app.request('/api/account/security/sessions?limit=2&offset=4', { headers: userHeaders() })
    await app.request('/api/account/security/sessions/session-1', { method: 'DELETE', headers: userHeaders() })
    await app.request('/api/account/security/sessions', { method: 'DELETE', headers: userHeaders() })

    await expect(sessions.json()).resolves.toEqual({
      sessions: [],
      pagination: {
        limit: 2,
        offset: 4,
        total: 10,
        hasMore: true,
        nextOffset: 6,
      },
    })
    expect(users.listSessions).toHaveBeenCalledWith('user-1', { limit: 2, offset: 4 })
    expect(security.getSessionToken).toHaveBeenCalledWith('user-1', 'session-1')
    expect(auth.api.revokeSession).toHaveBeenCalledWith({
      body: { token: 'session-token-1' },
      headers: expect.any(Headers),
    })
    expect(auth.api.revokeOtherSessions).toHaveBeenCalledWith({ headers: expect.any(Headers) })
  })

  it('blocks account security session endpoints when account center sessions are disabled', async () => {
    const auth = createAuthMock()
    const security = createSecurityRepositoryMock()
    const users = createUserRepositoryMock()
    vi.spyOn(configz, 'getConfig').mockResolvedValue({
      accountCenter: {
        profileEditingEnabled: true,
        displayNameEditable: true,
        usernameEditable: true,
        avatarEditable: false,
        emailChangeEnabled: true,
        passwordChangeEnabled: true,
        connectedAccountsEnabled: true,
        sessionsViewEnabled: false,
        dangerZoneEnabled: false,
      },
    } as Awaited<ReturnType<typeof configz.getConfig>>)
    const app = createApp(auth, createTestDeps({ users, security }), {
      securityPolicy: securityPolicy(),
    })
    const headers = userHeaders()

    const list = await app.request('/api/account/security/sessions', { headers })
    const revokeOne = await app.request('/api/account/security/sessions/session-1', { method: 'DELETE', headers })
    const revokeAll = await app.request('/api/account/security/sessions', { method: 'DELETE', headers })

    expect(list.status).toBe(403)
    expect(revokeOne.status).toBe(403)
    expect(revokeAll.status).toBe(403)
    expect(users.listSessions).not.toHaveBeenCalled()
    expect(security.getSessionToken).not.toHaveBeenCalled()
    expect(auth.api.revokeSession).not.toHaveBeenCalled()
    expect(auth.api.revokeOtherSessions).not.toHaveBeenCalled()
  })

  it('revokes authorized application consent for the current account [spec: account-center/authorized-app-revoke]', async () => {
    const deps = createTestDeps({
      users: createUserRepositoryMock(),
      security: createSecurityRepositoryMock(),
    })
    const app = createApp(createAuthMock(), deps, { securityPolicy: securityPolicy() })

    const response = await app.request('/api/account/applications/consent-1', {
      method: 'DELETE',
      headers: userHeaders(),
    })

    expect(response.status).toBe(204)
    expect(deps.applications.revokeConsent).toHaveBeenCalledWith('consent-1', 'user-1')
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
      enableTwoFactor: vi.fn().mockResolvedValue({ totpURI: 'otpauth://totp/FlareAuth', backupCodes: [] }),
      disableTwoFactor: vi.fn().mockResolvedValue({ status: true }),
      verifyTOTP: vi.fn().mockResolvedValue({ status: true }),
      generateBackupCodes: vi.fn().mockResolvedValue({ status: true, backupCodes: [] }),
      listPasskeys: vi.fn().mockResolvedValue([]),
      deletePasskey: vi.fn().mockResolvedValue({ status: true }),
      updatePasskey: vi.fn().mockResolvedValue({ passkey: { id: 'passkey-1' } }),
      revokeSession: vi.fn().mockResolvedValue({ status: true }),
      revokeSessions: vi.fn().mockResolvedValue({ status: true }),
      revokeOtherSessions: vi.fn().mockResolvedValue({ status: true }),
      revokeUserSession: vi.fn().mockResolvedValue({ success: true }),
      revokeUserSessions: vi.fn().mockResolvedValue({ success: true }),
      changeEmail: vi.fn().mockResolvedValue({ status: true }),
      changePassword: vi.fn().mockResolvedValue({ status: true }),
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

function createSecurityRepositoryMock(
  policy = securityPolicy(),
  options: { mfaEnabled?: boolean } = {},
): SecurityRepository {
  return {
    getPolicy: vi.fn().mockResolvedValue(policy),
    updatePolicy: vi.fn().mockResolvedValue(updatedSecurityPolicy()),
    getSecurityState: vi.fn().mockImplementation((userId: string) =>
      Promise.resolve({
        userId,
        mfa: {
          enabled: options.mfaEnabled ?? true,
          factors: [{ id: 'factor-1', type: 'totp', verified: true }],
        },
        passkeys: {
          enabled: policy.passkeys.enabled,
          count: 1,
        },
        policy,
      }),
    ),
    listPasskeys: vi.fn().mockImplementation((_userId, page) => Promise.resolve(createPage(page))),
    deletePasskey: vi.fn().mockResolvedValue(undefined),
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

function securityPolicy(overrides: Partial<SecurityPolicy> = {}): SecurityPolicy {
  return {
    mfa: {
      mode: 'optional',
      authenticatorAppEnabled: true,
      emailOtpEnabled: false,
      backupCodesEnabled: true,
      ...overrides.mfa,
    },
    passkeys: {
      enabled: true,
      rpId: 'auth.example.com',
      rpName: 'FlareAuth',
      origins: ['https://auth.example.com'],
      ...overrides.passkeys,
    },
    sessions: {
      expiresInSeconds: 60 * 60 * 24 * 7,
      updateAgeSeconds: 60 * 60 * 24,
      freshAgeSeconds: 60 * 60 * 24,
      cookieCacheSeconds: 60 * 5,
      ...overrides.sessions,
    },
    password: {
      minLength: 12,
      requiredCharacterTypes: 2,
      customWords: [],
      rejectUserInfo: true,
      rejectSequential: true,
      rejectCustomWords: false,
      ...overrides.password,
    },
    captcha: {
      enabled: false,
      provider: 'turnstile',
      siteKey: '',
      secretBinding: '',
      ...overrides.captcha,
    },
    blocklist: {
      blockSubaddressing: false,
      entries: [],
      ...overrides.blocklist,
    },
  }
}

function updatedSecurityPolicy(): SecurityPolicy {
  return securityPolicy({
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
  })
}

function _adminHeaders() {
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
