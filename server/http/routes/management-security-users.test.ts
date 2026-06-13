import { createApp } from '@server/http/app'
import type { SecurityRepository, UserRepository } from '@server/usecases/ports'
import type { SecurityPolicy } from '@shared/api/security'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../test-deps'

describe('management security user routes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('serves admin passkey and session lists and bulk revokes user sessions', async () => {
    const auth = createAuthMock()
    const security = createSecurityRepositoryMock()
    const users = createUserRepositoryMock()
    const app = createApp(
      auth,
      createTestDeps({
        users,
        security,
      }),
      { securityPolicy: securityPolicy() },
    )

    const passkeys = await app.request('/api/management/security/users/user-2/passkeys?limit=2&offset=4', {
      headers: adminHeaders(),
    })
    const sessions = await app.request('/api/management/security/users/user-2/sessions?limit=3&offset=6', {
      headers: adminHeaders(),
    })
    await app.request('/api/management/security/users/user-2/sessions', {
      method: 'DELETE',
      headers: adminHeaders(),
    })

    await expect(passkeys.json()).resolves.toEqual({
      passkeys: [],
      pagination: {
        limit: 2,
        offset: 4,
        total: 10,
        hasMore: true,
        nextOffset: 6,
      },
    })
    await expect(sessions.json()).resolves.toEqual({
      sessions: [],
      pagination: {
        limit: 3,
        offset: 6,
        total: 10,
        hasMore: true,
        nextOffset: 9,
      },
    })
    expect(security.listPasskeys).toHaveBeenCalledWith('user-2', { limit: 2, offset: 4 })
    expect(users.listSessions).toHaveBeenCalledWith('user-2', { limit: 3, offset: 6 })
    expect(auth.api.revokeUserSessions).toHaveBeenCalledWith({
      body: { userId: 'user-2' },
      headers: expect.any(Headers),
    })
  })

  it('persists admin security policy updates through both admin and management boundaries', async () => {
    const security = createSecurityRepositoryMock()
    const app = createApp(
      createAuthMock(),
      createTestDeps({
        users: createUserRepositoryMock(),
        security,
      }),
      { securityPolicy: securityPolicy() },
    )
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

    const adminResponse = await app.request('/api/management/security/policy', {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify(body),
    })
    const managementResponse = await app.request('/api/management/security/policy', {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify(body),
    })

    expect(adminResponse.status).toBe(200)
    expect(managementResponse.status).toBe(200)
    await expect(adminResponse.json()).resolves.toEqual({ policy: updatedSecurityPolicy() })
    await expect(managementResponse.json()).resolves.toEqual({ policy: updatedSecurityPolicy() })
    expect(security.updatePolicy).toHaveBeenCalledTimes(2)
    expect(security.updatePolicy).toHaveBeenCalledWith(body)
  })

  it('enforces password, blocklist, and CAPTCHA policy before delegated account flows [spec: account-center/password-policy-native-change]', async () => {
    const auth = createAuthMock()
    const policy = securityPolicy({
      password: {
        minLength: 12,
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
        entries: ['blocked@example.com', 'blocked.test'],
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

    const weakSignup = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ email: 'allowed@example.com', password: 'short', name: 'Allowed' }),
      headers: { 'content-type': 'application/json' },
    })
    const blockedSignup = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ email: 'user+test@example.com', password: 'Valid-pass-123', name: 'Allowed' }),
      headers: { 'content-type': 'application/json' },
    })
    const blockedEmailChange = await app.request('/api/account/email/change', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@blocked.test' }),
      headers: userHeaders(),
    })
    const weakPasswordChange = await app.request('/api/account/password/change', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: 'old-password',
        newPassword: 'abc123abc123',
        revokeOtherSessions: true,
      }),
      headers: userHeaders(),
    })
    const weakNativePasswordChange = await app.request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: 'old-password',
        newPassword: 'abc123abc123',
      }),
      headers: { 'content-type': 'application/json' },
    })
    const weakReset = await app.request('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: 'token-1', newPassword: 'abc123abc123' }),
      headers: { 'content-type': 'application/json' },
    })
    const weakOtpReset = await app.request('/api/auth/email-otp/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'allowed@example.com', otp: '123456', password: 'abc123abc123' }),
      headers: { 'content-type': 'application/json' },
    })
    const missingResetPassword = await app.request('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: 'token-1' }),
      headers: { 'content-type': 'application/json' },
    })
    const nonJsonSignup = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      body: new FormData(),
    })
    const getReset = await app.request('/api/auth/reset-password')

    expect(weakSignup.status).toBe(400)
    await expect(weakSignup.json()).resolves.toMatchObject({
      error: { message: 'Password must be at least 12 characters.' },
    })
    expect(blockedSignup.status).toBe(400)
    await expect(blockedSignup.json()).resolves.toMatchObject({
      error: { message: 'Email subaddressing is not allowed.' },
    })
    expect(blockedEmailChange.status).toBe(400)
    await expect(blockedEmailChange.json()).resolves.toMatchObject({
      error: { message: 'Email address is not allowed.' },
    })
    expect(weakPasswordChange.status).toBe(400)
    await expect(weakPasswordChange.json()).resolves.toMatchObject({
      error: { message: 'Password must include at least 3 character types.' },
    })
    expect(weakNativePasswordChange.status).toBe(400)
    await expect(weakNativePasswordChange.json()).resolves.toMatchObject({
      error: { message: 'Password must include at least 3 character types.' },
    })
    expect(weakReset.status).toBe(400)
    await expect(weakReset.json()).resolves.toMatchObject({
      error: { message: 'Password must include at least 3 character types.' },
    })
    expect(weakOtpReset.status).toBe(400)
    await expect(weakOtpReset.json()).resolves.toMatchObject({
      error: { message: 'Password must include at least 3 character types.' },
    })
    expect(missingResetPassword.status).toBe(400)
    await expect(missingResetPassword.json()).resolves.toMatchObject({
      error: { message: 'newPassword is required.' },
    })
    expect(nonJsonSignup.status).toBe(400)
    await expect(nonJsonSignup.json()).resolves.toMatchObject({
      error: { message: 'email is required.' },
    })
    expect(getReset.status).toBe(400)
    await expect(getReset.json()).resolves.toMatchObject({
      error: { message: 'newPassword is required.' },
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
