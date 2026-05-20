import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecurityPolicy } from '../../shared/api/security'
import { createApp } from '../app'
import { notFound } from '../lib/errors'
import type { AssetService } from '../modules/assets/service'
import type { SecurityRepository } from '../modules/security/repository'
import type { UserRepository } from '../modules/users/repository'

describe('security routes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('serves account security state and delegates MFA/passkey enrollment APIs to Better Auth', async () => {
    const auth = createAuthMock()
    const security = createSecurityRepositoryMock()
    const app = createApp(auth, {
      userRepository: createUserRepositoryMock(),
      securityRepository: security,
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
    await app.request('/api/account/security/passkeys/registration-options', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Laptop' }),
    })
    await app.request('/api/account/security/passkeys/registration-verification', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: 'credential-1', response: {} }),
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
    expect(auth.api.generatePasskeyRegistrationOptions).toHaveBeenCalledWith({
      query: { name: 'Laptop' },
      headers: expect.any(Headers),
    })
    expect(auth.api.verifyPasskeyRegistration).toHaveBeenCalledWith({
      body: { id: 'credential-1', response: {} },
      headers: expect.any(Headers),
    })
  })

  it('serves account MFA/passkey resources and delegates OTP, backup code, and passkey management', async () => {
    const auth = createAuthMock()
    const security = createSecurityRepositoryMock()
    const app = createApp(auth, {
      userRepository: createUserRepositoryMock(),
      securityRepository: security,
      securityPolicy: securityPolicy(),
    })
    const headers = userHeaders()

    const mfa = await app.request('/api/account/security/mfa', { headers })
    await app.request('/api/account/security/mfa/otp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ password: 'password-1' }),
    })
    await app.request('/api/account/security/mfa/otp-verification', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: '654321' }),
    })
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
    expect(auth.api.sendTwoFactorOTP).toHaveBeenCalledWith({
      body: {},
      headers: expect.any(Headers),
    })
    expect(auth.api.verifyTwoFactorOTP).toHaveBeenCalledWith({
      body: { code: '654321' },
      headers: expect.any(Headers),
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

  it('revokes account sessions by resolving the user-owned session token', async () => {
    const auth = createAuthMock()
    const security = createSecurityRepositoryMock()
    const users = createUserRepositoryMock()
    const app = createApp(auth, {
      userRepository: users,
      securityRepository: security,
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
    expect(auth.api.revokeSessions).toHaveBeenCalledWith({ headers: expect.any(Headers) })
  })

  it('blocks account security session endpoints when account center sessions are disabled', async () => {
    const auth = createAuthMock()
    const security = createSecurityRepositoryMock()
    const users = createUserRepositoryMock()
    const app = createApp(auth, {
      userRepository: users,
      securityRepository: security,
      securityPolicy: securityPolicy(),
      configzServiceFactory: () => ({
        getConfig: vi.fn().mockResolvedValue({
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
        }),
      }),
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
    expect(auth.api.revokeSessions).not.toHaveBeenCalled()
  })

  it('revokes authorized application consent for the current account', async () => {
    const applicationService = {
      list: vi.fn().mockResolvedValue({ pagination: { total: 1 } }),
      revokeConsent: vi.fn().mockResolvedValue(undefined),
    }
    const app = createApp(createAuthMock(), {
      userRepository: createUserRepositoryMock(),
      securityRepository: createSecurityRepositoryMock(),
      securityPolicy: securityPolicy(),
      applicationServiceFactory: () => applicationService,
    })

    const response = await app.request('/api/account/applications/consent-1', {
      method: 'DELETE',
      headers: userHeaders(),
    })

    expect(response.status).toBe(204)
    expect(applicationService.revokeConsent).toHaveBeenCalledWith('consent-1', 'user-1')
  })

  it('protects authorized application consent revocation and surfaces missing grants', async () => {
    const applicationService = {
      list: vi.fn().mockResolvedValue({ pagination: { total: 1 } }),
      revokeConsent: vi.fn().mockRejectedValue(notFound('Application consent was not found.')),
    }
    const app = createApp(createAuthMock(), {
      userRepository: createUserRepositoryMock(),
      securityRepository: createSecurityRepositoryMock(),
      securityPolicy: securityPolicy(),
      applicationServiceFactory: () => applicationService,
    })

    const unauthorized = await app.request('/api/account/applications/consent-1', { method: 'DELETE' })
    const missing = await app.request('/api/account/applications/consent-1', {
      method: 'DELETE',
      headers: userHeaders(),
    })

    expect(unauthorized.status).toBe(401)
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: 'not_found', message: 'Application consent was not found.' },
    })
  })

  it('rejects disabled passkey operations before calling Better Auth passkey APIs', async () => {
    const auth = createAuthMock()
    const policy = securityPolicy({ passkeys: { ...securityPolicy().passkeys, enabled: false } })
    const app = createApp(auth, {
      userRepository: createUserRepositoryMock(),
      securityRepository: createSecurityRepositoryMock(policy),
      securityPolicy: policy,
    })

    const response = await app.request('/api/account/security/passkeys/registration-options', {
      method: 'POST',
      headers: userHeaders(),
      body: JSON.stringify({ name: 'Laptop' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'bad_request',
        message: 'Passkeys are disabled for this deployment.',
      },
    })
    expect(auth.api.generatePasskeyRegistrationOptions).not.toHaveBeenCalled()
  })

  it('validates account security request payloads and translates Better Auth errors', async () => {
    const auth = createAuthMock()
    auth.api.disableTwoFactor.mockRejectedValueOnce({
      statusCode: 401,
      body: { message: 'Invalid password.' },
      message: 'Invalid password.',
    })
    const app = createApp(auth, {
      userRepository: createUserRepositoryMock(),
      securityRepository: createSecurityRepositoryMock(),
      securityPolicy: securityPolicy(),
    })

    const invalid = await app.request('/api/account/security/mfa/totp-verification', {
      method: 'POST',
      headers: userHeaders(),
      body: JSON.stringify({ trustDevice: true }),
    })
    const translated = await app.request('/api/account/security/mfa/totp', {
      method: 'DELETE',
      headers: userHeaders(),
      body: JSON.stringify({ password: 'bad-password' }),
    })

    expect(invalid.status).toBe(400)
    expect(auth.api.verifyTOTP).not.toHaveBeenCalled()
    expect(translated.status).toBe(401)
    await expect(translated.json()).resolves.toMatchObject({
      error: {
        code: 'unauthorized',
        message: 'Invalid password.',
      },
    })
  })

  it('enforces required MFA for protected APIs while allowing enrollment routes', async () => {
    const policy = securityPolicy({ mfa: { mode: 'required' } })
    const security = createSecurityRepositoryMock(policy, { mfaEnabled: false })
    const app = createApp(createAuthMock(), {
      userRepository: createUserRepositoryMock(),
      securityRepository: security,
      securityPolicy: policy,
      assetServiceFactory: () =>
        ({
          getObject: vi.fn().mockRejectedValue(notFound('Asset was not found.')),
        }) as unknown as AssetService,
    })

    const protectedResponse = await app.request('/api/account/profile', { headers: userHeaders() })
    const assetResponse = await app.request('/api/assets/asset-1', { headers: userHeaders() })
    const enrollmentResponse = await app.request('/api/account/security/mfa/totp-enrollment', {
      method: 'POST',
      headers: userHeaders(),
      body: JSON.stringify({ password: 'password-1' }),
    })

    expect(protectedResponse.status).toBe(403)
    await expect(protectedResponse.json()).resolves.toMatchObject({
      error: {
        code: 'forbidden',
        message: 'MFA enrollment is required for this deployment.',
      },
    })
    expect(assetResponse.status).toBe(404)
    expect(enrollmentResponse.status).toBe(201)
  })

  it('mounts account avatar uploads with account-center config in the full RPC app', async () => {
    const assets = {
      upload: vi.fn().mockResolvedValue({ asset: assetFixture() }),
      updateUserAvatar: vi.fn().mockResolvedValue(undefined),
    }
    const app = createApp(createAuthMock(), {
      userRepository: createUserRepositoryMock(),
      securityRepository: createSecurityRepositoryMock(),
      securityPolicy: securityPolicy(),
      assetServiceFactory: () => assets as unknown as AssetService,
      configzServiceFactory: () => ({
        getConfig: vi.fn().mockResolvedValue({
          accountCenter: {
            profileEditingEnabled: true,
            displayNameEditable: true,
            usernameEditable: true,
            avatarEditable: false,
            emailChangeEnabled: true,
            passwordChangeEnabled: true,
            connectedAccountsEnabled: true,
            sessionsViewEnabled: true,
            dangerZoneEnabled: false,
          },
        }),
      }),
    })

    const response = await requestWithFile(app, '/api/account/avatar', userHeaders())

    expect(response.status).toBe(403)
    expect(assets.upload).not.toHaveBeenCalled()
    expect(assets.updateUserAvatar).not.toHaveBeenCalled()
  })

  it('rejects MFA disable when deployment policy requires MFA', async () => {
    const auth = createAuthMock()
    const policy = securityPolicy({ mfa: { mode: 'required' } })
    const app = createApp(auth, {
      userRepository: createUserRepositoryMock(),
      securityRepository: createSecurityRepositoryMock(policy),
      securityPolicy: policy,
    })

    const response = await app.request('/api/account/security/mfa/totp', {
      method: 'DELETE',
      headers: userHeaders(),
      body: JSON.stringify({ password: 'password-1' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'forbidden',
        message: 'MFA cannot be disabled while it is required for this deployment.',
      },
    })
    expect(auth.api.disableTwoFactor).not.toHaveBeenCalled()
  })

  it('serves admin security resources and revokes user sessions', async () => {
    const auth = createAuthMock()
    const security = createSecurityRepositoryMock()
    const users = createUserRepositoryMock()
    const app = createApp(auth, {
      userRepository: users,
      securityRepository: security,
      securityPolicy: securityPolicy({ mfa: { mode: 'required' } }),
    })

    const policy = await app.request('/api/admin/security/policy', { headers: adminHeaders() })
    const state = await app.request('/api/admin/security/users/user-2', { headers: adminHeaders() })
    await app.request('/api/admin/security/users/user-2/passkeys/passkey-1', {
      method: 'DELETE',
      headers: adminHeaders(),
    })
    await app.request('/api/admin/security/users/user-2/sessions/session-1', {
      method: 'DELETE',
      headers: adminHeaders(),
    })

    await expect(policy.json()).resolves.toMatchObject({
      policy: {
        mfa: {
          mode: 'required',
        },
      },
    })
    await expect(state.json()).resolves.toMatchObject({
      security: {
        userId: 'user-2',
      },
    })
    expect(security.deletePasskey).toHaveBeenCalledWith('user-2', 'passkey-1')
    expect(security.getSessionToken).toHaveBeenCalledWith('user-2', 'session-1')
    expect(auth.api.revokeUserSession).toHaveBeenCalledWith({
      body: { sessionToken: 'session-token-1' },
      headers: expect.any(Headers),
    })
  })

  it('serves admin passkey and session lists and bulk revokes user sessions', async () => {
    const auth = createAuthMock()
    const security = createSecurityRepositoryMock()
    const users = createUserRepositoryMock()
    const app = createApp(auth, {
      userRepository: users,
      securityRepository: security,
      securityPolicy: securityPolicy(),
    })

    const passkeys = await app.request('/api/admin/security/users/user-2/passkeys?limit=2&offset=4', {
      headers: adminHeaders(),
    })
    const sessions = await app.request('/api/admin/security/users/user-2/sessions?limit=3&offset=6', {
      headers: adminHeaders(),
    })
    await app.request('/api/admin/security/users/user-2/sessions', {
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
      sendTwoFactorOTP: vi.fn().mockResolvedValue({ status: true }),
      verifyTwoFactorOTP: vi.fn().mockResolvedValue({ status: true }),
      generateBackupCodes: vi.fn().mockResolvedValue({ status: true, backupCodes: [] }),
      listPasskeys: vi.fn().mockResolvedValue([]),
      generatePasskeyRegistrationOptions: vi.fn().mockResolvedValue({ challenge: 'challenge-1' }),
      verifyPasskeyRegistration: vi.fn().mockResolvedValue({ verified: true }),
      deletePasskey: vi.fn().mockResolvedValue({ status: true }),
      updatePasskey: vi.fn().mockResolvedValue({ passkey: { id: 'passkey-1' } }),
      revokeSession: vi.fn().mockResolvedValue({ status: true }),
      revokeSessions: vi.fn().mockResolvedValue({ status: true }),
      revokeUserSession: vi.fn().mockResolvedValue({ success: true }),
      revokeUserSessions: vi.fn().mockResolvedValue({ success: true }),
    },
    handler: async () => new Response(null, { status: 204 }),
  }
}

function createUserRepositoryMock(): UserRepository {
  return {
    getUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
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

function securityPolicy(overrides: Partial<SecurityPolicy> = {}): SecurityPolicy {
  return {
    mfa: {
      mode: 'optional',
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
  }
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
