import { beforeEach, describe, expect, it, vi } from 'vitest'
import managementOpenApi from '../../docs/api/management.openapi.json'
import {
  listManagementConnectorsResponseSchema,
  managementCollectionRoutes,
  managementConnectorResponseSchema,
  managementReadinessResponseSchema,
} from '../../shared/api/management'
import type { SecurityPolicy } from '../../shared/api/security'
import { createApp } from '../app'
import type { SecurityRepository } from '../modules/security/repository'
import type { UserRepository } from '../modules/users/repository'

describe('management routes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('keeps the Management OpenAPI route inventory aligned with mounted routes', () => {
    const app = createApp(createAuthMock(), {
      userRepository: createUserRepositoryMock(),
      securityRepository: createSecurityRepositoryMock(),
      securityPolicy: securityPolicy(),
    })

    expect(openApiOperations()).toEqual(mountedManagementOperations(app))

    const operationIds = openApiOperationObjects().map((operation) => operation.operationId)
    expect(operationIds).not.toContain(undefined)
    expect(new Set(operationIds).size).toBe(operationIds.length)
    expect(managementOpenApi.security).toEqual([{ adminSession: [] }, { managementOAuth2: [] }])
    expect(managementOpenApi.components.securitySchemes.managementOAuth2).toMatchObject({
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: '/api/auth/oauth2/authorize',
          tokenUrl: '/api/auth/oauth2/token',
        },
      },
    })

    for (const operation of openApiOperationObjects()) {
      if (operation.key === managementOpenApiOperationKey) {
        expect(operation.security).toEqual([])
        continue
      }

      expect(operation.responses, operation.key).toHaveProperty('401')
      expect(operation.responses, operation.key).toHaveProperty('403')
      expect(operation.declaredPathParameters, operation.key).toEqual(operation.pathParameters)

      if (methodsWithJsonRequestBody.has(operation.method) && !operationsWithoutRequestBody.has(operation.key)) {
        expect(requestBodyContent(operation.requestBody), operation.key).toEqual(
          expect.objectContaining({
            schema: expect.any(Object),
          }),
        )
        expect(schemaReference(requestBodyContent(operation.requestBody).schema), operation.key).not.toBe(
          '#/components/schemas/GenericObject',
        )
        expect(() =>
          assertConstrainedOpenApiSchema(requestBodyContent(operation.requestBody).schema, operation.key),
        ).not.toThrow()
      }

      for (const schema of operation.jsonResponseSchemas) {
        expect(schema, operation.key).toEqual(expect.any(Object))
        expect(schemaReference(schema), operation.key).not.toBe('#/components/schemas/GenericObject')
        expect(() => assertConstrainedOpenApiSchema(schema, operation.key)).not.toThrow()
      }
    }
  })

  it('serves the Management OpenAPI contract with Restish discovery headers', async () => {
    const app = createApp(createAuthMock(), {
      userRepository: createUserRepositoryMock(),
      securityRepository: createSecurityRepositoryMock(),
      securityPolicy: securityPolicy(),
    })

    const contract = await app.request('/api/management/openapi.json')
    const protectedResponse = await app.request('/api/management/users')

    expect(contract.status).toBe(200)
    expect(contract.headers.get('content-type')).toContain('application/json')
    expect(contract.headers.get('link')).toContain('</api/management/openapi.json>; rel="service-desc"')
    expect(contract.headers.get('link')).toContain('</api/management/openapi.json>; rel="describedby"')
    await expect(contract.json()).resolves.toEqual(managementOpenApi)

    expect(protectedResponse.status).toBe(401)
    expect(protectedResponse.headers.get('link')).toContain('</api/management/openapi.json>; rel="service-desc"')
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
    const app = createApp(auth, {
      userRepository: createUserRepositoryMock(),
      securityRepository: createSecurityRepositoryMock(policy),
      securityPolicy: policy,
    })

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
    const app = createApp(createAuthMock(), {
      userRepository: createUserRepositoryMock(),
      securityRepository: security,
      securityPolicy: securityPolicy(),
    })
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
    await expect(settings.json()).resolves.toMatchObject({
      signIn: {
        passwordEnabled: true,
        signupEnabled: true,
        socialLoginEnabled: true,
        emailOtpEnabled: true,
        usernameEnabled: true,
        identifierFirst: false,
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
      builtInProviders: {
        phone: { enabled: false, smsProvider: 'twilio' },
        web3Wallet: { enabled: false, chains: [1], allowSignUp: true },
        passkey: { allowSignUp: true },
        oneTap: { enabled: false, clientId: '' },
      },
    })
  })

  it('updates managed sign-in, branding, and account center settings with validated input', async () => {
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
    const accountCenter = await app.request('/api/management/account-center-settings', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ accountCenter: { sessionsViewEnabled: false, emailChangeEnabled: false } }),
    })

    expect(signIn.status).toBe(200)
    expect(branding.status).toBe(200)
    expect(invalidCss.status).toBe(400)
    expect(accountCenter.status).toBe(200)
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
    expect(service.updateManagementAccountCenterSettings).toHaveBeenCalledWith({
      accountCenter: { sessionsViewEnabled: false, emailChangeEnabled: false },
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
            emailOtpEnabled: true,
            usernameEnabled: true,
            identifierFirst: false,
          },
          builtInProviders: {
            email: {
              enabled: true,
              otpLength: 6,
              expiresInSeconds: 300,
            },
            phone: {
              enabled: false,
              smsProvider: 'twilio',
              otpLength: 6,
              expiresInSeconds: 300,
              signUpOnVerification: false,
              requireVerification: true,
              twilioAccountSid: '',
              twilioAuthToken: '',
              twilioFromNumber: '',
              vonageApiKey: '',
              vonageApiSecret: '',
              vonageFrom: '',
              messageBirdAccessKey: '',
              messageBirdOriginator: '',
            },
            web3Wallet: {
              enabled: false,
              chains: [1],
              domain: '',
              emailDomainName: '',
              allowSignUp: true,
              ensLookupEnabled: false,
            },
            passkey: {
              allowSignUp: true,
            },
            oneTap: {
              enabled: false,
              clientId: '',
              autoSelect: false,
              cancelOnTapOutside: true,
              uxMode: 'popup',
              context: 'signin',
              promptBaseDelayMs: 1000,
              promptMaxAttempts: 5,
              disableSignUp: false,
            },
          },
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
    const accountCenter = await app.request('/api/management/account-center-settings', { headers })
    const accountCenterPatch = await app.request('/api/management/account-center-settings', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ accountCenter: { sessionsViewEnabled: false } }),
    })

    expect(signIn.status).toBe(200)
    expect(branding.status).toBe(200)
    expect(accountCenter.status).toBe(200)
    expect(accountCenterPatch.status).toBe(200)
    await expect(signIn.json()).resolves.toMatchObject({ copy: { productName: 'FlareAuth' } })
    await expect(branding.json()).resolves.toMatchObject({ branding: { primaryColor: null } })
    await expect(accountCenter.json()).resolves.toMatchObject({ accountCenter: { sessionsViewEnabled: true } })
    await expect(accountCenterPatch.json()).resolves.toMatchObject({ accountCenter: { sessionsViewEnabled: true } })
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
      configzServiceFactory: createConfigzServiceMock(),
    })

    const readiness = await app.request('/api/management/readiness', { headers: adminHeaders() })

    expect(readiness.status).toBe(200)
    const body = managementReadinessResponseSchema.parse(await readiness.json())
    expect(body).toMatchObject({
      required: [
        {
          id: 'oidc_application',
          label: 'Create an OIDC application',
          description: 'Register the first client so product routes can complete authorization code flows.',
          status: 'action_needed',
          href: '/console/onboarding',
          action: 'Create client',
        },
        {
          id: 'sign_in_method',
          label: 'Enable a sign-in method',
          description: 'Keep at least one hosted sign-in method available for users.',
          status: 'complete',
          href: '/console/sign-in-experience/sign-up-and-sign-in',
          action: 'Review methods',
        },
      ],
      admin: {
        setupRequired: true,
        setupHref: '/console/onboarding',
        missing: ['oidc_application'],
      },
    })
    expect(body.recommended).toHaveLength(4)
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
      configzServiceFactory: createConfigzServiceMock(),
    })

    const readiness = await app.request('/api/management/readiness', { headers: adminHeaders() })

    expect(readiness.status).toBe(200)
    const body = managementReadinessResponseSchema.parse(await readiness.json())
    expect(body.admin).toEqual({
      setupRequired: false,
      setupHref: '/console/onboarding',
      missing: [],
    })
    expect(body.required.every((item: { status: string }) => item.status === 'complete')).toBe(true)
  })

  it('does not count social sign-in as ready without a configured provider or connector', async () => {
    const app = createApp(createAuthMock(), {
      applicationServiceFactory: () => ({
        list: vi.fn().mockResolvedValue({
          applications: [applicationFixture()],
          pagination: { limit: 1, offset: 0, total: 1, hasMore: false, nextOffset: null },
        }),
        revokeConsent: vi.fn().mockResolvedValue(undefined),
      }),
      configzServiceFactory: createConfigzServiceMock({
        identityProviders: [],
        signIn: {
          passwordEnabled: false,
          emailOtpEnabled: false,
          socialLoginEnabled: true,
        },
      }),
      connectorServiceFactory: () => ({
        ...createConnectorServiceMock(),
        list: vi.fn().mockResolvedValue({
          connectors: [],
          pagination: { limit: 1, offset: 0, total: 0, hasMore: false, nextOffset: null },
        }),
      }),
    })

    const readiness = await app.request('/api/management/readiness', { headers: adminHeaders() })

    expect(readiness.status).toBe(200)
    const body = managementReadinessResponseSchema.parse(await readiness.json())
    expect(body.admin).toEqual({
      setupRequired: true,
      setupHref: '/console/onboarding',
      missing: ['sign_in_method'],
    })
    expect(body.required.find((item) => item.id === 'sign_in_method')?.status).toBe('action_needed')
    expect(body.recommended.find((item) => item.id === 'connector_status')?.status).toBe('action_needed')
  })

  it('does not count disabled social connectors as ready sign-in methods', async () => {
    const app = createApp(createAuthMock(), {
      applicationServiceFactory: () => ({
        list: vi.fn().mockResolvedValue({
          applications: [applicationFixture()],
          pagination: { limit: 1, offset: 0, total: 1, hasMore: false, nextOffset: null },
        }),
        revokeConsent: vi.fn().mockResolvedValue(undefined),
      }),
      configzServiceFactory: createConfigzServiceMock({
        identityProviders: [],
        signIn: {
          passwordEnabled: false,
          emailOtpEnabled: false,
          socialLoginEnabled: true,
        },
      }),
      connectorServiceFactory: () => ({
        ...createConnectorServiceMock(),
        list: vi.fn().mockResolvedValue({
          connectors: [{ ...connectorFixture(), enabled: false }],
          pagination: { limit: 1, offset: 0, total: 1, hasMore: false, nextOffset: null },
        }),
      }),
    })

    const readiness = await app.request('/api/management/readiness', { headers: adminHeaders() })

    expect(readiness.status).toBe(200)
    const body = managementReadinessResponseSchema.parse(await readiness.json())
    expect(body.admin.missing).toEqual(['sign_in_method'])
    expect(body.required.find((item) => item.id === 'sign_in_method')?.status).toBe('action_needed')
    expect(body.recommended.find((item) => item.id === 'connector_status')?.status).toBe('action_needed')
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
        clientSecret: 'secret://google',
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
        clientSecret: 'secret://google',
        scopes: ['openid', 'email', 'profile'],
      }),
    )
    expect(connectors.update).toHaveBeenCalledWith('connector-1', { enabled: false, displayName: 'Google Workspace' })
    expect(connectors.delete).toHaveBeenCalledWith('connector-1')
  })

  it('stores connector client secrets without returning secret values', async () => {
    const connectors = createConnectorServiceMock()
    const app = createApp(createAuthMock(), {
      connectorServiceFactory: () => connectors,
    })
    const headers = adminHeaders()

    const created = await app.request('/api/management/connectors', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        providerType: 'social',
        providerId: 'github',
        displayName: 'GitHub',
        enabled: true,
        clientId: 'review-client-id',
        clientSecret: 'REVIEW_CLIENT_SECRET',
      }),
    })
    const updated = await app.request('/api/management/connectors/connector-1', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        enabled: true,
        clientSecret: 'REVIEW_CLIENT_SECRET',
      }),
    })
    const list = await app.request('/api/management/connectors?limit=1&offset=0', { headers })
    const templates = await app.request('/api/management/connectors/templates', { headers })

    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toMatchObject({ clientSecretConfigured: true })
    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toMatchObject({ clientSecretConfigured: true })
    expect(list.status).toBe(200)
    expect(templates.status).toBe(200)
    expect(connectors.create).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: 'REVIEW_CLIENT_SECRET' }))
    expect(connectors.update).toHaveBeenCalledWith(
      'connector-1',
      expect.objectContaining({ clientSecret: 'REVIEW_CLIENT_SECRET' }),
    )
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
        clientSecret: 'secret://saml',
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
        clientSecret: 'secret://okta',
        authorizationEndpoint: 'https://idp.example.com/oauth2/v1/authorize',
      }),
    })

    expect(response.status).toBe(400)
    expect(connectors.create).not.toHaveBeenCalled()
  })

  it('exposes webhook endpoint and request resources through the management boundary', async () => {
    const webhooks = createWebhookServiceMock()
    const app = createApp(createAuthMock(), { webhookServiceFactory: () => webhooks })
    const headers = adminHeaders()

    const list = await app.request('/api/management/webhooks/endpoints?limit=10&offset=5&search=auth&status=enabled', {
      headers,
    })
    const created = await app.request('/api/management/webhooks/endpoints', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: 'https://events.example.com/flareauth',
        events: ['user.created'],
        enabled: true,
      }),
    })
    const detail = await app.request('/api/management/webhooks/endpoints/wh_1', { headers })
    const updated = await app.request('/api/management/webhooks/endpoints/wh_1', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ enabled: false }),
    })
    const rotated = await app.request('/api/management/webhooks/endpoints/wh_1/secrets', { method: 'POST', headers })
    const requests = await app.request('/api/management/webhooks/requests?limit=2&offset=4&status=failed', {
      headers,
    })
    const requestDetail = await app.request('/api/management/webhooks/requests/whr_1', { headers })
    const retried = await app.request('/api/management/webhooks/requests/whr_1/retries', { method: 'POST', headers })
    const deleted = await app.request('/api/management/webhooks/endpoints/wh_1', { method: 'DELETE', headers })

    expect(list.status).toBe(200)
    await expect(list.json()).resolves.toEqual({
      endpoints: [webhookEndpointResponse()],
      pagination: { limit: 10, offset: 5, total: 1, hasMore: false, nextOffset: null },
    })
    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toEqual({
      endpoint: webhookEndpointResponse(),
      signingSecret: 'whsec_created_secret',
    })
    await expect(detail.json()).resolves.toEqual(webhookEndpointResponse())
    await expect(updated.json()).resolves.toEqual({ ...webhookEndpointResponse(), enabled: false })
    expect(rotated.status).toBe(201)
    await expect(rotated.json()).resolves.toEqual({
      endpoint: webhookEndpointResponse(),
      signingSecret: 'whsec_rotated_secret',
    })
    await expect(requests.json()).resolves.toEqual({
      requests: [webhookRequestResponse()],
      pagination: { limit: 2, offset: 4, total: 1, hasMore: false, nextOffset: null },
    })
    await expect(requestDetail.json()).resolves.toEqual(webhookRequestResponse())
    expect(retried.status).toBe(202)
    await expect(retried.json()).resolves.toEqual({ ...webhookRequestResponse(), status: 'pending' })
    expect(deleted.status).toBe(204)

    expect(webhooks.listEndpoints).toHaveBeenCalledWith({
      limit: 10,
      offset: 5,
      search: 'auth',
      status: 'enabled',
    })
    expect(webhooks.createEndpoint).toHaveBeenCalledWith(
      { url: 'https://events.example.com/flareauth', events: ['user.created'], enabled: true },
      'admin-1',
    )
    expect(webhooks.updateEndpoint).toHaveBeenCalledWith('wh_1', { enabled: false })
    expect(webhooks.rotateSecret).toHaveBeenCalledWith('wh_1')
    expect(webhooks.listRequests).toHaveBeenCalledWith({ limit: 2, offset: 4, status: 'failed' })
    expect(webhooks.getRequest).toHaveBeenCalledWith('whr_1')
    expect(webhooks.retryRequest).toHaveBeenCalledWith('whr_1')
    expect(webhooks.deleteEndpoint).toHaveBeenCalledWith('wh_1')
  })

  it('protects and validates webhook management requests', async () => {
    const webhooks = createWebhookServiceMock()
    const app = createApp(createAuthMock(), { webhookServiceFactory: () => webhooks })

    const unauthenticated = await app.request('/api/management/webhooks/endpoints')
    const nonAdmin = await app.request('/api/management/webhooks/endpoints', { headers: userHeaders() })
    const invalid = await app.request('/api/management/webhooks/endpoints', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ url: 'http://events.example.com/flareauth', events: [] }),
    })

    expect(unauthenticated.status).toBe(401)
    expect(nonAdmin.status).toBe(403)
    expect(invalid.status).toBe(400)
    expect(webhooks.createEndpoint).not.toHaveBeenCalled()
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

function createSecurityRepositoryMock(policy = securityPolicy()): SecurityRepository {
  return {
    getPolicy: vi.fn().mockResolvedValue(policy),
    updatePolicy: vi.fn().mockResolvedValue(updatedSecurityPolicy()),
    getSecurityState: vi.fn().mockResolvedValue({
      userId: 'user-1',
      mfa: { enabled: true, factors: [] },
      passkeys: { enabled: policy.passkeys.enabled, count: 1 },
      policy,
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

function mountedManagementOperations(app: unknown) {
  return [
    ...new Set(
      honoRoutes(app)
        .filter((route) => route.method !== 'ALL')
        .map(toManagementOperationKey),
    ),
  ]
    .filter((key) => key !== null)
    .sort()
}

function openApiOperations() {
  return openApiOperationObjects()
    .map(({ key }) => key)
    .sort()
}

function openApiOperationObjects() {
  return Object.entries(managementOpenApi.paths).flatMap(([path, pathItem]) =>
    Object.entries(resolveOpenApiPathItem(pathItem))
      .filter(([method]) => isManagementOpenApiMethod(method))
      .map(([method, operation]) => {
        const resolvedPathItem = resolveOpenApiPathItem(pathItem)
        const resolvedOperation = openApiOperation(operation)
        const key = `${method.toUpperCase()} ${normalizeManagementPath(path)}`
        return {
          key,
          method: method.toUpperCase(),
          pathParameters: pathParameterNames(path),
          declaredPathParameters: declaredPathParameterNames(resolvedPathItem, resolvedOperation),
          operationId: resolvedOperation.operationId,
          requestBody: resolvedOperation.requestBody,
          responses: resolvedOperation.responses,
          security: resolvedOperation.security,
          jsonResponseSchemas: Object.values(resolvedOperation.responses)
            .map((response) => openApiJsonResponseSchema(response))
            .filter((schema) => schema !== null),
        }
      }),
  )
}

function resolveOpenApiPathItem(pathItem: unknown) {
  const record = openApiRecord(pathItem)
  const ref = record.$ref

  if (typeof ref !== 'string') {
    return record
  }

  const pathItems = managementOpenApi.components.pathItems as Record<string, unknown>
  return openApiRecord(pathItems[ref.replace('#/components/pathItems/', '')])
}

function toManagementOperationKey(route: HonoRoute) {
  if (!route.path.startsWith('/api/management')) {
    return null
  }

  return `${route.method} ${normalizeManagementPath(route.path.replace('/api/management', '') || '/')}`
}

function normalizeManagementPath(path: string) {
  return path.replace(/:[^/]+/g, '{param}').replace(/\{[^}]+}/g, '{param}')
}

function pathParameterNames(path: string) {
  return [...path.matchAll(/\{([^}]+)}/g)].map((match) => match[1]).sort()
}

function declaredPathParameterNames(pathItem: Record<string, unknown>, operation: OpenApiOperation) {
  return [...openApiParameters(pathItem.parameters), ...openApiParameters(operation.parameters)]
    .filter((parameter) => parameter.in === 'path')
    .map((parameter) => parameter.name)
    .sort()
}

function openApiParameters(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((parameter) => {
    const record = openApiRecord(parameter)
    const ref = record.$ref
    if (typeof ref !== 'string') {
      return record as unknown as OpenApiParameter
    }

    const parameters = managementOpenApi.components.parameters as Record<string, unknown>
    return openApiRecord(parameters[ref.replace('#/components/parameters/', '')]) as unknown as OpenApiParameter
  })
}

function requestBodyContent(value: unknown) {
  const content = openApiRecord(openApiRecord(value).content)
  const mediaType = content['application/json'] ?? content['multipart/form-data']
  return openApiRecord(mediaType)
}

function schemaReference(value: unknown) {
  const ref = openApiRecord(value).$ref
  return typeof ref === 'string' ? ref : null
}

function assertConstrainedOpenApiSchema(value: unknown, path: string, seen = new Set<string>()) {
  if (value === undefined || value === null || typeof value === 'boolean') {
    throw new Error(`${path} is not a concrete schema object`)
  }

  const schema = openApiRecord(value)
  const ref = schema.$ref
  if (typeof ref === 'string') {
    if (ref === '#/components/schemas/GenericObject') {
      throw new Error(`${path} uses GenericObject`)
    }
    if (seen.has(ref)) {
      return
    }
    seen.add(ref)
    assertConstrainedOpenApiSchema(resolveOpenApiSchemaRef(ref), `${path} ${ref}`, seen)
    return
  }

  if (schema.type === 'object') {
    const properties = schema.properties === undefined ? {} : openApiRecord(schema.properties)
    const additionalProperties = schema.additionalProperties
    if (Object.keys(properties).length === 0 && additionalProperties === undefined) {
      throw new Error(`${path} uses an unconstrained object schema`)
    }
    if (additionalProperties === true) {
      throw new Error(`${path} uses additionalProperties: true`)
    }
    if (additionalProperties !== undefined && typeof additionalProperties !== 'boolean') {
      assertConstrainedOpenApiSchema(additionalProperties, `${path} additionalProperties`, seen)
    }
    for (const [property, propertySchema] of Object.entries(properties)) {
      assertConstrainedOpenApiSchema(propertySchema, `${path}.${property}`, seen)
    }
  }

  if (schema.items) {
    assertConstrainedOpenApiSchema(schema.items, `${path}[]`, seen)
  }

  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    const variants = schema[key]
    if (Array.isArray(variants)) {
      for (const [index, variant] of variants.entries()) {
        assertConstrainedOpenApiSchema(variant, `${path}.${key}[${index}]`, seen)
      }
    }
  }
}

function resolveOpenApiSchemaRef(ref: string) {
  const schemas = managementOpenApi.components.schemas as Record<string, unknown>
  return schemas[ref.replace('#/components/schemas/', '')]
}

function honoRoutes(app: unknown) {
  return (app as { routes: HonoRoute[] }).routes
}

function openApiRecord(value: unknown) {
  return value as Record<string, unknown>
}

function openApiOperation(value: unknown) {
  return value as OpenApiOperation
}

function openApiJsonResponseSchema(value: unknown) {
  const record = openApiRecord(value)
  const ref = record.$ref
  const response =
    typeof ref === 'string' ? openApiRecord(openApiResponses()[ref.replace('#/components/responses/', '')]) : record
  if (response.content === undefined) {
    return null
  }

  const content = openApiRecord(response.content)
  const jsonResponse = content['application/json']

  if (jsonResponse === undefined) {
    return null
  }

  return openApiRecord(jsonResponse).schema
}

function openApiResponses() {
  return managementOpenApi.components.responses as Record<string, unknown>
}

function isManagementOpenApiMethod(method: string): method is ManagementOpenApiMethod {
  return managementOpenApiMethods.includes(method as ManagementOpenApiMethod)
}

const managementOpenApiMethods = ['get', 'post', 'put', 'patch', 'delete'] as const
type ManagementOpenApiMethod = (typeof managementOpenApiMethods)[number]
const managementOpenApiOperationKey = 'GET /openapi.json'
const methodsWithJsonRequestBody = new Set(['POST', 'PUT', 'PATCH'])
const operationsWithoutRequestBody = new Set([
  'POST /applications/{param}/client-secrets',
  'POST /users/{param}/unban',
  'POST /webhooks/endpoints/{param}/secrets',
  'POST /webhooks/requests/{param}/retries',
])

interface HonoRoute {
  method: string
  path: string
}

interface OpenApiOperation {
  operationId?: string
  parameters?: unknown
  requestBody?: unknown
  responses: Record<string, unknown>
  security?: unknown
}

interface OpenApiParameter {
  name: string
  in: string
}

function securityPolicy(overrides: Partial<SecurityPolicy> = {}): SecurityPolicy {
  const policy: SecurityPolicy = {
    mfa: { mode: 'optional' },
    passkeys: {
      enabled: true,
      rpId: 'auth.example.com',
      rpName: 'FlareAuth',
      origins: ['https://auth.example.com'],
    },
    sessions: {
      expiresInSeconds: 3600,
      updateAgeSeconds: 300,
      freshAgeSeconds: 600,
      cookieCacheSeconds: 60,
    },
    password: {
      minLength: 12,
      requiredCharacterTypes: 2,
      customWords: [],
      rejectUserInfo: true,
      rejectSequential: true,
      rejectCustomWords: false,
    },
    captcha: {
      enabled: false,
      provider: 'turnstile',
      siteKey: '',
      secretBinding: '',
    },
    blocklist: {
      blockSubaddressing: false,
      entries: [],
    },
  }
  return {
    ...policy,
    ...overrides,
    mfa: { ...policy.mfa, ...overrides.mfa },
    passkeys: { ...policy.passkeys, ...overrides.passkeys },
    sessions: { ...policy.sessions, ...overrides.sessions },
    password: { ...policy.password, ...overrides.password },
    captcha: { ...policy.captcha, ...overrides.captcha },
    blocklist: { ...policy.blocklist, ...overrides.blocklist },
  }
}

function updatedSecurityPolicy(): SecurityPolicy {
  return {
    ...securityPolicy(),
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
  }
}

function createConfigzServiceMock(
  overrides: {
    identityProviders?: Array<Record<string, unknown>>
    signIn?: Partial<{
      passwordEnabled: boolean
      signupEnabled: boolean
      socialLoginEnabled: boolean
      emailOtpEnabled: boolean
      usernameEnabled: boolean
      identifierFirst: boolean
    }>
  } = {},
) {
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
        emailOtpEnabled: true,
        usernameEnabled: true,
        identifierFirst: false,
      },
      builtInProviders: builtInProvidersFixture(),
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
        userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
        endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/logout',
      },
      security: {
        mfaRequired: false,
        sessionExpiresInSeconds: 0,
        passkeysEnabled: false,
      },
      accountCenter: {
        profileEditingEnabled: true,
        displayNameEditable: true,
        usernameEditable: true,
        avatarEditable: true,
        emailChangeEnabled: true,
        passwordChangeEnabled: true,
        connectedAccountsEnabled: true,
        sessionsViewEnabled: true,
        dangerZoneEnabled: false,
      },
    }
    config.signIn = { ...config.signIn, ...overrides.signIn }
    if (overrides.identityProviders) {
      config.identityProviders = overrides.identityProviders as typeof config.identityProviders
    }
    return {
      getConfig: vi.fn().mockResolvedValue(config),
      updateManagementSignInSettings: vi.fn().mockResolvedValue({
        signIn: config.signIn,
        builtInProviders: config.builtInProviders,
        links: config.links,
        copy: config.copy,
      }),
      updateManagementBrandingSettings: vi.fn().mockResolvedValue({
        branding: config.branding,
        copy: config.copy,
      }),
      updateManagementAccountCenterSettings: vi.fn().mockResolvedValue({
        accountCenter: config.accountCenter,
      }),
    }
  }
}

function builtInProvidersFixture() {
  return {
    email: {
      enabled: true,
      otpLength: 6,
      expiresInSeconds: 300,
    },
    phone: {
      enabled: false,
      smsProvider: 'twilio',
      otpLength: 6,
      expiresInSeconds: 300,
      signUpOnVerification: false,
      requireVerification: true,
      twilioAccountSid: '',
      twilioAuthToken: '',
      twilioFromNumber: '',
      vonageApiKey: '',
      vonageApiSecret: '',
      vonageFrom: '',
      messageBirdAccessKey: '',
      messageBirdOriginator: '',
    },
    web3Wallet: {
      enabled: false,
      chains: [1],
      domain: '',
      emailDomainName: '',
      allowSignUp: true,
      ensLookupEnabled: false,
    },
    passkey: {
      allowSignUp: true,
    },
    oneTap: {
      enabled: false,
      clientId: '',
      autoSelect: false,
      cancelOnTapOutside: true,
      uxMode: 'popup',
      context: 'signin',
      promptBaseDelayMs: 1000,
      promptMaxAttempts: 5,
      disableSignUp: false,
    },
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
          requiredFields: ['clientId', 'clientSecret'],
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

function createWebhookServiceMock() {
  return {
    listEndpoints: vi.fn().mockImplementation((query) =>
      Promise.resolve({
        endpoints: [webhookEndpointResponse()],
        pagination: { limit: query.limit, offset: query.offset, total: 1, hasMore: false, nextOffset: null },
      }),
    ),
    createEndpoint: vi.fn().mockResolvedValue({
      endpoint: webhookEndpointResponse(),
      signingSecret: 'whsec_created_secret',
    }),
    getEndpoint: vi.fn().mockResolvedValue(webhookEndpointResponse()),
    updateEndpoint: vi.fn().mockResolvedValue({ ...webhookEndpointResponse(), enabled: false }),
    deleteEndpoint: vi.fn().mockResolvedValue(undefined),
    rotateSecret: vi.fn().mockResolvedValue({
      endpoint: webhookEndpointResponse(),
      signingSecret: 'whsec_rotated_secret',
    }),
    listRequests: vi.fn().mockImplementation((query) =>
      Promise.resolve({
        requests: [webhookRequestResponse()],
        pagination: { limit: query.limit, offset: query.offset, total: 1, hasMore: false, nextOffset: null },
      }),
    ),
    getRequest: vi.fn().mockResolvedValue(webhookRequestResponse()),
    retryRequest: vi.fn().mockResolvedValue({ ...webhookRequestResponse(), status: 'pending' }),
  }
}

function webhookEndpointResponse() {
  return {
    id: 'wh_1',
    url: 'https://app.example.com/webhooks/auth',
    events: ['user.created', 'session.revoked'],
    enabled: true,
    secretPrefix: 'whsec_abcd123',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function webhookRequestResponse() {
  return {
    id: 'whr_1',
    endpointId: 'wh_1',
    endpointUrl: 'https://app.example.com/webhooks/auth',
    event: 'user.created',
    status: 'failed',
    attemptCount: 1,
    httpStatus: 500,
    error: 'Server error',
    requestBody: '{"id":"user-1"}',
    responseBody: '{"error":"failed"}',
    nextAttemptAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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
    clientSecretConfigured: true,
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
