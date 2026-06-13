import { createApp } from '@server/http/app'
import { managementReadinessResponseSchema } from '@shared/api/management'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  adminHeaders,
  applicationFixture,
  connectorFixture,
  createAuthMock,
  createConfigzServiceMock,
  createConnectorServiceMock,
} from './management.test-utils'

describe('management routes 3', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
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

  it('does not count the system CLI client as the tenant OIDC application for readiness', async () => {
    const app = createApp(createAuthMock(), {
      applicationServiceFactory: () => ({
        list: vi.fn().mockResolvedValue({
          applications: [
            { ...applicationFixture(), id: 'app_flareauth_cli', clientId: 'flareauth-cli', systemManaged: true },
          ],
          pagination: { limit: 100, offset: 0, total: 1, hasMore: false, nextOffset: null },
        }),
        revokeConsent: vi.fn().mockResolvedValue(undefined),
      }),
      configzServiceFactory: createConfigzServiceMock(),
    })

    const readiness = await app.request('/api/management/readiness', { headers: adminHeaders() })

    expect(readiness.status).toBe(200)
    const body = managementReadinessResponseSchema.parse(await readiness.json())
    expect(body.admin).toEqual({
      setupRequired: true,
      setupHref: '/console/onboarding',
      missing: ['oidc_application'],
    })
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
})
