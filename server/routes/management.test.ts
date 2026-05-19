import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listManagementConnectorsResponseSchema,
  managementCollectionRoutes,
  managementConnectorResponseSchema,
  managementReadinessResponseSchema,
} from '../../shared/api/management'
import { createApp } from '../app'
import type { SecurityRepository } from '../modules/security/repository'
import type { UserRepository } from '../modules/users/repository'

describe('management routes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('mounts the documented management collections behind the admin boundary', async () => {
    const app = createApp(createAuthMock(), { userRepository: createUserRepositoryMock() })

    for (const route of managementCollectionRoutes) {
      const response = await app.request(`/api/management${route}`)
      expect(response.status, route).toBe(401)
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: 'unauthorized',
        },
      })
    }
  })

  it('rejects non-admin sessions from management APIs', async () => {
    const response = await createApp(createAuthMock(), { userRepository: createUserRepositoryMock() }).request(
      '/api/management/users',
      {
        headers: userHeaders(),
      },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'forbidden',
        message: 'Admin access is required.',
      },
    })
  })

  it('delegates management user collection requests through the stable management path', async () => {
    const auth = createAuthMock()
    const response = await createApp(auth, { userRepository: createUserRepositoryMock() }).request(
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
  })

  it('keeps admin user list compatibility while normalizing management user lists', async () => {
    const auth = createAuthMock()
    auth.api.listUsers.mockResolvedValueOnce({ users: [{ id: 'user-1' }], total: 1, limit: 50 })
    auth.api.listUsers.mockResolvedValueOnce({ users: [{ id: 'user-1' }], total: 1, limit: 50 })
    const app = createApp(auth, { userRepository: createUserRepositoryMock() })

    const adminResponse = await app.request('/api/admin/users', { headers: adminHeaders() })
    const managementResponse = await app.request('/api/management/users', { headers: adminHeaders() })

    await expect(adminResponse.json()).resolves.toEqual({ users: [{ id: 'user-1' }], total: 1, limit: 50 })
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
    const response = await createApp(createAuthMock()).request('/api/management/applications', {
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
    const app = createApp(auth, { userRepository: createUserRepositoryMock() })
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
    const app = createApp(auth, { userRepository: users })
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
    const app = createApp(createAuthMock(), {
      userRepository: createUserRepositoryMock(),
      securityRepository: security,
    })
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
        policy: securityPolicyFixture,
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

  it('updates and revokes specific managed users through the management boundary', async () => {
    const auth = createAuthMock()
    const users = createUserRepositoryMock()
    const app = createApp(auth, { userRepository: users })
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

  it('exposes managed sign-in settings', async () => {
    const app = createApp(createAuthMock(), {
      configzServiceFactory: createConfigzServiceMock(),
    })

    const settings = await app.request('/api/management/sign-in-settings', { headers: adminHeaders() })

    expect(settings.status).toBe(200)
    await expect(settings.json()).resolves.toEqual({
      signIn: {
        passwordEnabled: true,
        signupEnabled: true,
        socialLoginEnabled: true,
        magicLinkEnabled: true,
        emailOtpEnabled: true,
        usernameEnabled: true,
        identifierFirst: false,
      },
      defaults: {
        applicationId: 'app-1',
        redirectUri: 'https://app.example.com/callback',
      },
      links: {
        termsUri: null,
        privacyUri: null,
        supportEmail: 'support@example.com',
      },
      copy: {
        productName: 'FlareAuth',
        headline: 'Sign in',
        description: 'Continue.',
      },
    })
  })

  it('updates managed sign-in and branding settings with validated runtime-safe CSS', async () => {
    const service = createConfigzServiceMock()()
    const app = createApp(createAuthMock(), {
      configzServiceFactory: () => service,
    })
    const headers = adminHeaders()

    const signIn = await app.request('/api/management/sign-in-settings', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        signIn: { passwordEnabled: false, identifierFirst: true },
        links: { supportEmail: 'help@example.com' },
        copy: { productName: 'Acme ID' },
      }),
    })
    const branding = await app.request('/api/management/branding-settings', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        branding: {
          logoUrl: 'https://cdn.example.com/logo.svg',
          faviconUrl: 'https://cdn.example.com/favicon.ico',
          primaryColor: '#2563eb',
          backgroundColor: '#ffffff',
          customCss: '--auth-panel-radius: 8px;',
        },
      }),
    })
    const invalidCss = await app.request('/api/management/branding-settings', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ branding: { customCss: '.authPanel { background: red; }' } }),
    })

    expect(signIn.status).toBe(200)
    expect(branding.status).toBe(200)
    expect(invalidCss.status).toBe(400)
    expect(service.updateManagementSignInSettings).toHaveBeenCalledWith({
      signIn: { passwordEnabled: false, identifierFirst: true },
      links: { supportEmail: 'help@example.com' },
      copy: { productName: 'Acme ID' },
    })
    expect(service.updateManagementBrandingSettings).toHaveBeenCalledWith({
      branding: {
        logoUrl: 'https://cdn.example.com/logo.svg',
        faviconUrl: 'https://cdn.example.com/favicon.ico',
        primaryColor: '#2563eb',
        backgroundColor: '#ffffff',
        customCss: '--auth-panel-radius: 8px;',
      },
    })
  })

  it('exposes managed branding settings', async () => {
    const app = createApp(createAuthMock(), {
      configzServiceFactory: createConfigzServiceMock(),
    })

    const settings = await app.request('/api/management/branding-settings', { headers: adminHeaders() })

    expect(settings.status).toBe(200)
    await expect(settings.json()).resolves.toEqual({
      branding: {
        logoUrl: null,
        faviconUrl: null,
        primaryColor: null,
        backgroundColor: null,
        customCss: null,
      },
      copy: {
        productName: 'FlareAuth',
        headline: 'Sign in',
        description: 'Continue.',
      },
    })
  })

  it('uses management-specific configz readers when available', async () => {
    const app = createApp(createAuthMock(), {
      configzServiceFactory: () => ({
        getConfig: async () => {
          throw new Error('getConfig should not be called')
        },
        getManagementSignInSettings: async () => ({
          signIn: {
            passwordEnabled: true,
            signupEnabled: true,
            socialLoginEnabled: true,
            magicLinkEnabled: true,
            emailOtpEnabled: true,
            usernameEnabled: true,
            identifierFirst: false,
          },
          defaults: { applicationId: null, redirectUri: null },
          links: { termsUri: null, privacyUri: null, supportEmail: null },
          copy: { productName: 'Dedicated ID', headline: 'Sign in', description: 'Continue.' },
        }),
        getManagementBrandingSettings: async () => ({
          branding: {
            logoUrl: null,
            faviconUrl: null,
            primaryColor: '#2563eb',
            backgroundColor: '#ffffff',
            customCss: null,
          },
          copy: { productName: 'Dedicated ID', headline: 'Sign in', description: 'Continue.' },
        }),
      }),
    })
    const headers = adminHeaders()
    const signIn = await app.request('/api/management/sign-in-settings', { headers })
    const branding = await app.request('/api/management/branding-settings', { headers })

    await expect(signIn.json()).resolves.toMatchObject({ copy: { productName: 'Dedicated ID' } })
    await expect(branding.json()).resolves.toMatchObject({ branding: { primaryColor: '#2563eb' } })
  })

  it('normalizes management setting PATCH responses when the service is read-only', async () => {
    const service = createConfigzServiceMock()()
    const app = createApp(createAuthMock(), {
      configzServiceFactory: () => ({ getConfig: service.getConfig }),
    })
    const headers = adminHeaders()

    const signIn = await app.request('/api/management/sign-in-settings', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ signIn: { identifierFirst: true } }),
    })
    const branding = await app.request('/api/management/branding-settings', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ branding: { primaryColor: '#2563eb' } }),
    })

    expect(signIn.status).toBe(200)
    expect(branding.status).toBe(200)
    await expect(signIn.json()).resolves.toMatchObject({ copy: { productName: 'FlareAuth' } })
    await expect(branding.json()).resolves.toMatchObject({ branding: { primaryColor: null } })
  })

  it('exposes admin setup readiness through the management boundary', async () => {
    const app = createApp(createAuthMock(), {
      applicationServiceFactory: () => ({
        list: vi.fn().mockResolvedValue({
          applications: [],
          pagination: { limit: 1, offset: 0, total: 0, hasMore: false, nextOffset: null },
        }),
        revokeConsent: vi.fn().mockResolvedValue(undefined),
      }),
    })

    const readiness = await app.request('/api/management/readiness', { headers: adminHeaders() })

    expect(readiness.status).toBe(200)
    await expect(readiness.json()).resolves.toEqual(
      managementReadinessResponseSchema.parse({
        admin: {
          setupRequired: true,
          setupHref: '/admin/onboarding',
          missing: ['oidc_application'],
        },
      }),
    )
  })

  it('reports admin setup complete when an OIDC application exists', async () => {
    const app = createApp(createAuthMock(), {
      applicationServiceFactory: () => ({
        list: vi.fn().mockResolvedValue({
          applications: [applicationFixture()],
          pagination: { limit: 1, offset: 0, total: 1, hasMore: false, nextOffset: null },
        }),
        revokeConsent: vi.fn().mockResolvedValue(undefined),
      }),
    })

    const readiness = await app.request('/api/management/readiness', { headers: adminHeaders() })

    expect(readiness.status).toBe(200)
    await expect(readiness.json()).resolves.toEqual(
      managementReadinessResponseSchema.parse({
        admin: {
          setupRequired: false,
          setupHref: '/admin/onboarding',
          missing: [],
        },
      }),
    )
  })

  it('exposes management connector config CRUD with pagination', async () => {
    const connectors = createConnectorServiceMock()
    const app = createApp(createAuthMock(), {
      connectorServiceFactory: () => connectors,
    })
    const headers = adminHeaders()

    const list = await app.request('/api/management/connectors?limit=1&offset=0', { headers })
    const templates = await app.request('/api/management/connectors/templates', { headers })
    const created = await app.request('/api/management/connectors', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'google',
        providerType: 'social',
        providerId: 'google',
        displayName: 'Google',
        enabled: true,
        clientId: 'client-1',
        clientSecretBinding: 'secret://google',
        issuer: 'https://accounts.google.com',
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        userInfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
        jwksEndpoint: 'https://www.googleapis.com/oauth2/v3/certs',
        scopes: ['openid', 'email', 'profile'],
        providerMetadata: { prompt: 'select_account' },
      }),
    })
    const detail = await app.request('/api/management/connectors/connector-1', { headers })
    const readiness = await app.request('/api/management/connectors/connector-1/readiness', { headers })
    const updated = await app.request('/api/management/connectors/connector-1', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ enabled: false, displayName: 'Google Workspace' }),
    })
    const deleted = await app.request('/api/management/connectors/connector-1', { method: 'DELETE', headers })

    expect(list.status).toBe(200)
    await expect(list.json()).resolves.toEqual(
      listManagementConnectorsResponseSchema.parse({
        connectors: [connectorFixture()],
        pagination: {
          limit: 1,
          offset: 0,
          total: 1,
          hasMore: false,
          nextOffset: null,
        },
      }),
    )
    expect(templates.status).toBe(200)
    await expect(templates.json()).resolves.toMatchObject({
      templates: [expect.objectContaining({ providerId: 'google', icon: 'google' })],
    })
    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toEqual(managementConnectorResponseSchema.parse(connectorFixture()))
    await expect(detail.json()).resolves.toEqual(managementConnectorResponseSchema.parse(connectorFixture()))
    await expect(readiness.json()).resolves.toMatchObject({
      connectorId: 'connector-1',
      ready: true,
      checks: [expect.objectContaining({ key: 'clientId', ok: true })],
    })
    await expect(updated.json()).resolves.toEqual(
      managementConnectorResponseSchema.parse({
        ...connectorFixture(),
        enabled: false,
        displayName: 'Google Workspace',
      }),
    )
    expect(deleted.status).toBe(204)
    expect(connectors.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'google',
        providerType: 'social',
        clientSecretBinding: 'secret://google',
        scopes: ['openid', 'email', 'profile'],
      }),
    )
    expect(connectors.update).toHaveBeenCalledWith('connector-1', { enabled: false, displayName: 'Google Workspace' })
    expect(connectors.delete).toHaveBeenCalledWith('connector-1')
  })

  it('rejects unsupported connector provider types at the request boundary', async () => {
    const connectors = createConnectorServiceMock()
    const response = await createApp(createAuthMock(), {
      connectorServiceFactory: () => connectors,
    }).request('/api/management/connectors', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        slug: 'saml',
        providerType: 'saml',
        providerId: 'saml',
        displayName: 'SAML',
        clientId: 'client-1',
        clientSecretBinding: 'secret://saml',
      }),
    })

    expect(response.status).toBe(400)
    expect(connectors.create).not.toHaveBeenCalled()
  })

  it('reuses connector contracts for generic OAuth request validation', async () => {
    const connectors = createConnectorServiceMock()
    const response = await createApp(createAuthMock(), {
      connectorServiceFactory: () => connectors,
    }).request('/api/management/connectors', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        providerType: 'generic_oauth',
        providerId: 'okta-main',
        displayName: 'Okta',
        clientId: 'client-1',
        clientSecretBinding: 'secret://okta',
        authorizationEndpoint: 'https://idp.example.com/oauth2/v1/authorize',
      }),
    })

    expect(response.status).toBe(400)
    expect(connectors.create).not.toHaveBeenCalled()
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
      revokeUserSession: vi.fn().mockResolvedValue({ success: true }),
      revokeUserSessions: vi.fn().mockResolvedValue({ success: true }),
      requestPasswordReset: vi.fn().mockResolvedValue({ status: true }),
      sendVerificationEmail: vi.fn().mockResolvedValue({ status: true }),
      changeEmail: vi.fn().mockResolvedValue({ status: true }),
      changePassword: vi.fn().mockResolvedValue({ status: true }),
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
    listLinkedAccounts: vi.fn().mockResolvedValue(createPage({ limit: 50, offset: 0 })),
    listConsentedApplications: vi.fn().mockResolvedValue(createPage({ limit: 50, offset: 0 })),
    listSessions: vi.fn().mockResolvedValue(createPage({ limit: 50, offset: 0 })),
    getSessionToken: vi.fn().mockResolvedValue('session-token-1'),
  }
}

const securityPolicyFixture = {
  mfa: { mode: 'optional' as const },
  passkeys: { enabled: true, rpId: 'auth.example.com', rpName: 'FlareAuth', origins: ['https://auth.example.com'] },
  sessions: {
    expiresInSeconds: 3600,
    updateAgeSeconds: 300,
    freshAgeSeconds: 300,
    cookieCacheSeconds: 60,
  },
}

function createSecurityRepositoryMock(): SecurityRepository {
  return {
    getSecurityState: vi.fn().mockResolvedValue({
      userId: 'user-1',
      mfa: { enabled: true, factors: [] },
      passkeys: { enabled: true, count: 1 },
      policy: securityPolicyFixture,
    }),
    listPasskeys: vi.fn().mockImplementation((_userId, page) =>
      Promise.resolve({
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
        limit: page.limit,
        offset: page.offset,
        total: 10,
      }),
    ),
    deletePasskey: vi.fn().mockResolvedValue(undefined),
    getSessionToken: vi.fn().mockResolvedValue('session-token-1'),
  }
}

function createConfigzServiceMock() {
  return () => {
    const config = {
      onboarding: {
        required: false,
        href: '/onboarding',
      },
      signIn: {
        passwordEnabled: true,
        signupEnabled: true,
        socialLoginEnabled: true,
        magicLinkEnabled: true,
        emailOtpEnabled: true,
        usernameEnabled: true,
        identifierFirst: false,
      },
      branding: {
        logoUrl: null,
        faviconUrl: null,
        primaryColor: null,
        backgroundColor: null,
        customCss: null,
      },
      identityProviders: [
        {
          slug: 'google',
          providerType: 'oauth2',
          providerId: 'google',
          displayName: 'Google',
          icon: 'google',
          authorizationUrl: 'https://auth.example.com/api/auth/sign-in/social?provider=google',
        },
        {
          slug: 'github',
          providerType: 'oauth2',
          providerId: 'github',
          displayName: 'GitHub',
          icon: 'github',
          authorizationUrl: 'https://auth.example.com/api/auth/sign-in/social?provider=github',
        },
      ],
      links: {
        termsUri: null,
        privacyUri: null,
        supportEmail: 'support@example.com',
      },
      copy: {
        productName: 'FlareAuth',
        headline: 'Sign in',
        description: 'Continue.',
      },
      defaults: {
        applicationId: 'app-1',
        redirectUri: 'https://app.example.com/callback',
      },
      auth: {
        basePath: '/api/auth' as const,
        signInEmailPath: '/api/auth/sign-in/email' as const,
        signInUsernamePath: '/api/auth/sign-in/username' as const,
        signUpEmailPath: '/api/auth/sign-up/email' as const,
        signOutPath: '/api/auth/sign-out' as const,
        requestPasswordResetPath: '/api/auth/request-password-reset' as const,
        resetPasswordPath: '/api/auth/reset-password' as const,
        sendVerificationEmailPath: '/api/auth/send-verification-email' as const,
        verifyEmailPath: '/api/auth/verify-email' as const,
        magicLinkPath: '/api/auth/sign-in/magic-link' as const,
        emailOtpPath: '/api/auth/email-otp/send-verification-otp' as const,
        emailOtpSignInPath: '/api/auth/sign-in/email-otp' as const,
        emailOtpVerificationPath: '/api/auth/email-otp/verify-email' as const,
        emailOtpPasswordResetRequestPath: '/api/auth/email-otp/request-password-reset' as const,
        emailOtpPasswordResetPath: '/api/auth/email-otp/reset-password' as const,
      },
      oidc: {
        issuer: 'https://auth.example.com/api/auth',
        discoveryUrl: 'https://auth.example.com/api/auth/.well-known/openid-configuration',
        authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
        tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
        jwksUri: 'https://auth.example.com/api/auth/jwks',
        userInfoEndpoint: 'https://auth.example.com/api/auth/userinfo',
        endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/logout',
      },
      security: {
        mfaRequired: false,
        sessionExpiresInSeconds: 0,
        passkeysEnabled: false,
      },
    }
    return {
      getConfig: vi.fn().mockResolvedValue(config),
      updateManagementSignInSettings: vi.fn().mockResolvedValue({
        signIn: config.signIn,
        defaults: config.defaults,
        links: config.links,
        copy: config.copy,
      }),
      updateManagementBrandingSettings: vi.fn().mockResolvedValue({
        branding: config.branding,
        copy: config.copy,
      }),
    }
  }
}

function createConnectorServiceMock() {
  return {
    list: vi.fn().mockResolvedValue({
      connectors: [connectorFixture()],
      pagination: {
        limit: 1,
        offset: 0,
        total: 1,
        hasMore: false,
        nextOffset: null,
      },
    }),
    listTemplates: vi.fn().mockReturnValue({
      templates: [
        {
          providerType: 'social',
          providerId: 'google',
          displayName: 'Google',
          icon: 'google',
          requiredFields: ['clientId', 'clientSecretBinding'],
          optionalFields: ['scopes'],
          defaultScopes: ['openid', 'email', 'profile'],
          endpoints: {
            issuer: null,
            authorizationEndpoint: null,
            tokenEndpoint: null,
            userInfoEndpoint: null,
            jwksEndpoint: null,
          },
        },
      ],
    }),
    create: vi.fn().mockResolvedValue(connectorFixture()),
    get: vi.fn().mockResolvedValue(connectorFixture()),
    readiness: vi.fn().mockResolvedValue({
      connectorId: 'connector-1',
      ready: true,
      checks: [{ key: 'clientId', label: 'Client ID configured', ok: true, message: 'Client ID is configured.' }],
    }),
    update: vi.fn().mockResolvedValue({ ...connectorFixture(), enabled: false, displayName: 'Google Workspace' }),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

function connectorFixture() {
  return {
    id: 'connector-1',
    slug: 'google',
    providerType: 'social',
    providerId: 'google',
    displayName: 'Google',
    enabled: true,
    clientId: 'client-1',
    clientSecretBinding: 'secret://google',
    issuer: 'https://accounts.google.com',
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    userInfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
    jwksEndpoint: 'https://www.googleapis.com/oauth2/v3/certs',
    scopes: ['openid', 'email', 'profile'],
    providerMetadata: { prompt: 'select_account' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function applicationFixture() {
  return {
    id: 'app-1',
    slug: 'customer-portal',
    name: 'Customer portal',
    clientId: 'client-1',
    clientType: 'public_spa',
    redirectUris: ['https://app.example.com/callback'],
    disabled: false,
  }
}

function createPage(page: { limit: number; offset: number }) {
  return {
    items: [],
    total: 10,
    ...page,
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
