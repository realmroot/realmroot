import { createApp } from '@server/http/app'
import type { SecurityRepository, UserRepository } from '@server/usecases/ports'
import type { SecurityPolicy } from '@shared/api/security'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../test-deps'

describe('management security policy routes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('verifies CAPTCHA tokens for hosted auth requests when enabled', async () => {
    const verify = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const policy = securityPolicy({
      captcha: {
        enabled: true,
        provider: 'turnstile',
        siteKey: 'site-key-1',
        secretBinding: 'TURNSTILE_SECRET',
      },
    })
    const app = createApp(
      createAuthMock(),
      createTestDeps({
        users: createUserRepositoryMock(),
        security: createSecurityRepositoryMock(policy),
      }),
      { securityPolicy: policy },
    )

    const missing = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com', password: 'password-1' }),
      headers: { 'content-type': 'application/json' },
    })
    const verified = await app.request(
      '/api/auth/sign-in/email',
      {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com', password: 'password-1', captchaToken: 'captcha-token-1' }),
        headers: { 'content-type': 'application/json' },
      },
      { TURNSTILE_SECRET: 'secret-1' },
    )
    const verifiedOtpRequest = await app.request(
      '/api/auth/email-otp/send-verification-otp',
      {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com', type: 'sign-in', captchaToken: 'captcha-token-2' }),
        headers: { 'content-type': 'application/json' },
      },
      { TURNSTILE_SECRET: 'secret-1' },
    )
    const missingSecret = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com', password: 'password-1', captchaToken: 'captcha-token-3' }),
      headers: { 'content-type': 'application/json' },
    })
    verify.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const failedVerification = await app.request(
      '/api/auth/sign-in/email',
      {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com', password: 'password-1', captchaToken: 'captcha-token-4' }),
        headers: { 'content-type': 'application/json' },
      },
      { TURNSTILE_SECRET: 'secret-1' },
    )
    const malformed = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      body: '{',
      headers: { 'content-type': 'application/json' },
    })

    expect(missing.status).toBe(400)
    await expect(missing.json()).resolves.toMatchObject({ error: { message: 'CAPTCHA verification is required.' } })
    expect(verified.status).toBe(204)
    expect(verifiedOtpRequest.status).toBe(204)
    expect(missingSecret.status).toBe(400)
    await expect(missingSecret.json()).resolves.toMatchObject({
      error: { message: 'CAPTCHA secret binding is not configured.' },
    })
    expect(failedVerification.status).toBe(400)
    await expect(failedVerification.json()).resolves.toMatchObject({
      error: { message: 'CAPTCHA verification failed.' },
    })
    expect(malformed.status).toBe(400)
    await expect(malformed.json()).resolves.toMatchObject({ error: { message: 'Invalid JSON body.' } })
    expect(verify).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST' }),
    )
    verify.mockRestore()
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

function _userHeaders() {
  return {
    'content-type': 'application/json',
    'x-user-id': 'user-1',
    'x-user-role': 'user',
  }
}
