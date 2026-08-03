import { createApp } from '@server/http/app'
import * as applications from '@server/usecases/applications'
import * as configz from '@server/usecases/configz'
import { managementReadinessResponseSchema } from '@shared/api/management'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDeps } from '../test-deps'
import { adminHeaders, applicationFixture, builtInProvidersFixture, createAuthMock } from './management.test-utils'

type SignInSettings = Awaited<ReturnType<typeof configz.getManagementSignInSettings>>
type BrandingSettings = Awaited<ReturnType<typeof configz.getManagementBrandingSettings>>
type AccountCenterSettings = Awaited<ReturnType<typeof configz.getManagementAccountCenterSettings>>
type RealmSettings = Awaited<ReturnType<typeof configz.getManagementRealm>>
type EmailSettings = Awaited<ReturnType<typeof configz.getEmailDeliveryConfiguration>>
type ConfigzConfig = Awaited<ReturnType<typeof configz.getConfig>>
type ListApplicationsResponse = Awaited<ReturnType<typeof applications.listApplications>>

const links = {
  termsUri: null,
  privacyUri: null,
  supportEmail: 'support@example.com',
}

const copy = {
  productName: 'Realmroot',
  headline: 'Sign in',
  description: 'Continue.',
}

const signIn = {
  passwordEnabled: true,
  signupEnabled: true,
  socialLoginEnabled: true,
  emailOtpEnabled: true,
  usernameEnabled: true,
  identifierFirst: false,
}

const branding = {
  logoUrl: null,
  faviconUrl: null,
  primaryColor: null,
  backgroundColor: null,
  customCss: null,
}

const accountCenter = {
  profileEditingEnabled: true,
  displayNameEditable: true,
  usernameEditable: true,
  avatarEditable: true,
  emailChangeEnabled: true,
  passwordChangeEnabled: true,
  connectedAccountsEnabled: true,
  sessionsViewEnabled: true,
  dangerZoneEnabled: false,
}

function signInSettings(): SignInSettings {
  return {
    signIn,
    builtInProviders: builtInProvidersFixture(),
    links,
    copy,
  } as SignInSettings
}

function brandingSettings(): BrandingSettings {
  return { branding, copy } as BrandingSettings
}

function accountCenterSettings(): AccountCenterSettings {
  return { accountCenter } as AccountCenterSettings
}

function readinessConfig(
  overrides: { identityProviders?: unknown[]; signIn?: Partial<typeof signIn> } = {},
): ConfigzConfig {
  return {
    signIn: { ...signIn, ...overrides.signIn },
    builtInProviders: builtInProvidersFixture(),
    branding,
    identityProviders: overrides.identityProviders ?? [
      { slug: 'google', providerType: 'oauth2', providerId: 'google', displayName: 'Google', icon: 'google' },
      { slug: 'github', providerType: 'oauth2', providerId: 'github', displayName: 'GitHub', icon: 'github' },
    ],
    links,
    copy,
    accountCenter,
  } as unknown as ConfigzConfig
}

describe('management routes 3', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes managed sign-in settings', async () => {
    vi.spyOn(configz, 'getManagementSignInSettings').mockResolvedValue(signInSettings())
    const app = createApp(createAuthMock(), createTestDeps())

    const settings = await app.request('/api/sign-in-settings', { headers: adminHeaders() })

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
        productName: 'Realmroot',
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

  it('persists General and Email settings through dedicated management resources', async () => {
    const realm: RealmSettings = {
      id: 'realm',
      name: 'Acme Realm',
      issuer: 'https://auth.example.com/api/auth',
      oidcDiscoveryUrl: 'https://auth.example.com/api/auth/.well-known/openid-configuration',
      jwksUrl: 'https://auth.example.com/api/auth/jwks',
      managementApiUrl: 'https://auth.example.com/api/openapi.json',
    }
    const email: EmailSettings = {
      provider: 'cloudflare_email',
      enabled: true,
      fromEmail: 'auth@example.com',
      fromName: 'Acme Realm',
      replyToEmail: 'support@example.com',
      bindingAvailable: true,
      source: 'database',
    }
    vi.spyOn(configz, 'getManagementRealm').mockResolvedValue(realm)
    vi.spyOn(configz, 'getEmailDeliveryConfiguration').mockResolvedValue(email)
    const updateRealm = vi.spyOn(configz, 'updateManagementRealm').mockResolvedValue(realm)
    const updateEmail = vi.spyOn(configz, 'replaceEmailDeliveryConfiguration').mockResolvedValue(email)
    const app = createApp(createAuthMock(), createTestDeps())
    const headers = adminHeaders()

    const realmRead = await app.request('/api/realm', { headers })
    const realmWrite = await app.request('/api/realm', {
      method: 'PATCH',
      headers: { ...headers, 'If-Match': realmRead.headers.get('ETag')! },
      body: JSON.stringify({ name: 'Acme Realm' }),
    })
    const emailRead = await app.request('/api/email-delivery-configuration', { headers })
    const emailWrite = await app.request('/api/email-delivery-configuration', {
      method: 'PUT',
      headers: { ...headers, 'If-Match': emailRead.headers.get('ETag')! },
      body: JSON.stringify({
        provider: 'cloudflare_email',
        enabled: true,
        fromEmail: 'auth@example.com',
        fromName: 'Acme Realm',
        replyToEmail: 'support@example.com',
      }),
    })
    const missingRealmPrecondition = await app.request('/api/realm', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Lost update' }),
    })
    const staleRealmPrecondition = await app.request('/api/realm', {
      method: 'PATCH',
      headers: { ...headers, 'If-Match': '"stale"' },
      body: JSON.stringify({ name: 'Lost update' }),
    })

    expect(realmRead.status).toBe(200)
    expect(realmWrite.status).toBe(200)
    expect(emailRead.status).toBe(200)
    expect(emailWrite.status).toBe(200)
    expect(realmRead.headers.get('ETag')).toMatch(/^"[a-f0-9]{64}"$/)
    expect(realmWrite.headers.get('ETag')).toMatch(/^"[a-f0-9]{64}"$/)
    expect(emailRead.headers.get('ETag')).toMatch(/^"[a-f0-9]{64}"$/)
    expect(emailWrite.headers.get('ETag')).toMatch(/^"[a-f0-9]{64}"$/)
    expect(missingRealmPrecondition.status).toBe(428)
    expect(staleRealmPrecondition.status).toBe(412)
    await expect(realmRead.json()).resolves.toEqual(realm)
    await expect(emailRead.json()).resolves.toEqual(email)
    expect(updateRealm).toHaveBeenCalledWith(expect.anything(), expect.anything(), { name: 'Acme Realm' })
    expect(updateEmail).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      provider: 'cloudflare_email',
      enabled: true,
      fromEmail: 'auth@example.com',
      fromName: 'Acme Realm',
      replyToEmail: 'support@example.com',
    })
  })

  it('updates managed sign-in, branding, and account center settings with validated input', async () => {
    const updateSignIn = vi.spyOn(configz, 'updateManagementSignInSettings').mockResolvedValue(signInSettings())
    const updateBranding = vi.spyOn(configz, 'updateManagementBrandingSettings').mockResolvedValue(brandingSettings())
    const updateAccountCenter = vi
      .spyOn(configz, 'updateManagementAccountCenterSettings')
      .mockResolvedValue(accountCenterSettings())
    const app = createApp(createAuthMock(), createTestDeps())
    const headers = adminHeaders()

    const signInResponse = await app.request('/api/sign-in-settings', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        signIn: { passwordEnabled: false, identifierFirst: true },
        links: { supportUri: 'https://example.com/support' },
        copy: { productName: 'Acme ID' },
      }),
    })
    const brandingResponse = await app.request('/api/branding-settings', {
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
    const invalidCss = await app.request('/api/branding-settings', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ branding: { customCss: '.authPanel { background: red; }' } }),
    })
    const accountCenterResponse = await app.request('/api/account-center-settings', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ accountCenter: { sessionsViewEnabled: false, emailChangeEnabled: false } }),
    })

    expect(signInResponse.status).toBe(200)
    expect(brandingResponse.status).toBe(200)
    expect(invalidCss.status).toBe(400)
    expect(accountCenterResponse.status).toBe(200)
    expect(updateSignIn).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      signIn: { passwordEnabled: false, identifierFirst: true },
      links: { supportUri: 'https://example.com/support' },
      copy: { productName: 'Acme ID' },
    })
    expect(updateBranding).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      branding: {
        logoUrl: 'https://cdn.example.com/logo.svg',
        faviconUrl: 'https://cdn.example.com/favicon.ico',
        primaryColor: '#2563eb',
        backgroundColor: '#ffffff',
        customCss: '--auth-panel-radius: 8px;',
      },
    })
    expect(updateAccountCenter).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      accountCenter: { sessionsViewEnabled: false, emailChangeEnabled: false },
    })
  })

  it('exposes managed branding settings', async () => {
    vi.spyOn(configz, 'getManagementBrandingSettings').mockResolvedValue(brandingSettings())
    const app = createApp(createAuthMock(), createTestDeps())

    const settings = await app.request('/api/branding-settings', { headers: adminHeaders() })

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
        productName: 'Realmroot',
        headline: 'Sign in',
        description: 'Continue.',
      },
    })
  })

  it('persists independent Organization creation and Console access policies [spec: admin-console/admin-developer-access-policy]', async () => {
    const organizationCreation: Awaited<ReturnType<typeof configz.getOrganizationCreationPolicy>> = {
      mode: 'verified_users',
      approvedUserIds: [],
    }
    const consoleAccess: Awaited<ReturnType<typeof configz.getDeveloperConsoleAccessPolicy>> = {
      mode: 'selected_organizations',
      eligibleAccessLevels: ['owner', 'admin', 'developer'],
      selectedOrganizationIds: ['org-1'],
    }
    const getCreation = vi.spyOn(configz, 'getOrganizationCreationPolicy').mockResolvedValue(organizationCreation)
    const replaceCreation = vi
      .spyOn(configz, 'replaceOrganizationCreationPolicy')
      .mockResolvedValue(organizationCreation)
    const getAccess = vi.spyOn(configz, 'getDeveloperConsoleAccessPolicy').mockResolvedValue(consoleAccess)
    const replaceAccess = vi.spyOn(configz, 'replaceDeveloperConsoleAccessPolicy').mockResolvedValue(consoleAccess)
    const app = createApp(createAuthMock(), createTestDeps())
    const headers = adminHeaders()

    const creationRead = await app.request('/api/organization-creation-policy', { headers })
    const creationWrite = await app.request('/api/organization-creation-policy', {
      method: 'PUT',
      headers: { ...headers, 'If-Match': creationRead.headers.get('ETag')! },
      body: JSON.stringify(organizationCreation),
    })
    const accessRead = await app.request('/api/developer-console-access-policy', { headers })
    const accessWrite = await app.request('/api/developer-console-access-policy', {
      method: 'PUT',
      headers: { ...headers, 'If-Match': accessRead.headers.get('ETag')! },
      body: JSON.stringify(consoleAccess),
    })

    expect(creationRead.status).toBe(200)
    expect(creationWrite.status).toBe(200)
    expect(accessRead.status).toBe(200)
    expect(accessWrite.status).toBe(200)
    expect(creationRead.headers.get('ETag')).toMatch(/^"[a-f0-9]{64}"$/)
    expect(creationWrite.headers.get('ETag')).toMatch(/^"[a-f0-9]{64}"$/)
    expect(accessRead.headers.get('ETag')).toMatch(/^"[a-f0-9]{64}"$/)
    expect(accessWrite.headers.get('ETag')).toMatch(/^"[a-f0-9]{64}"$/)
    await expect(creationRead.json()).resolves.toEqual(organizationCreation)
    await expect(accessRead.json()).resolves.toEqual(consoleAccess)
    expect(getCreation).toHaveBeenCalledWith(expect.anything())
    expect(replaceCreation).toHaveBeenCalledWith(expect.anything(), organizationCreation)
    expect(getAccess).toHaveBeenCalledWith(expect.anything())
    expect(replaceAccess).toHaveBeenCalledWith(expect.anything(), consoleAccess)
  })

  it('uses management-specific configz readers when available', async () => {
    vi.spyOn(configz, 'getManagementSignInSettings').mockResolvedValue({
      signIn: {
        passwordEnabled: true,
        signupEnabled: true,
        socialLoginEnabled: true,
        emailOtpEnabled: true,
        usernameEnabled: true,
        identifierFirst: false,
      },
      builtInProviders: builtInProvidersFixture(),
      links: { termsUri: null, privacyUri: null, supportEmail: null },
      copy: { productName: 'Dedicated ID', headline: 'Sign in', description: 'Continue.' },
    } as SignInSettings)
    vi.spyOn(configz, 'getManagementBrandingSettings').mockResolvedValue({
      branding: {
        logoUrl: null,
        faviconUrl: null,
        primaryColor: '#2563eb',
        backgroundColor: '#ffffff',
        customCss: null,
      },
      copy: { productName: 'Dedicated ID', headline: 'Sign in', description: 'Continue.' },
    } as BrandingSettings)
    const app = createApp(createAuthMock(), createTestDeps())
    const headers = adminHeaders()
    const signInResponse = await app.request('/api/sign-in-settings', { headers })
    const brandingResponse = await app.request('/api/branding-settings', { headers })

    await expect(signInResponse.json()).resolves.toMatchObject({ copy: { productName: 'Dedicated ID' } })
    await expect(brandingResponse.json()).resolves.toMatchObject({ branding: { primaryColor: '#2563eb' } })
  })

  it('normalizes management setting PATCH responses when the service is read-only', async () => {
    vi.spyOn(configz, 'updateManagementSignInSettings').mockResolvedValue(signInSettings())
    vi.spyOn(configz, 'updateManagementBrandingSettings').mockResolvedValue(brandingSettings())
    vi.spyOn(configz, 'getManagementAccountCenterSettings').mockResolvedValue(accountCenterSettings())
    vi.spyOn(configz, 'updateManagementAccountCenterSettings').mockResolvedValue(accountCenterSettings())
    const app = createApp(createAuthMock(), createTestDeps())
    const headers = adminHeaders()

    const signInResponse = await app.request('/api/sign-in-settings', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ signIn: { identifierFirst: true } }),
    })
    const brandingResponse = await app.request('/api/branding-settings', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ branding: { primaryColor: '#2563eb' } }),
    })
    const accountCenterResponse = await app.request('/api/account-center-settings', { headers })
    const accountCenterPatch = await app.request('/api/account-center-settings', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ accountCenter: { sessionsViewEnabled: false } }),
    })

    expect(signInResponse.status).toBe(200)
    expect(brandingResponse.status).toBe(200)
    expect(accountCenterResponse.status).toBe(200)
    expect(accountCenterPatch.status).toBe(200)
    await expect(signInResponse.json()).resolves.toMatchObject({ copy: { productName: 'Realmroot' } })
    await expect(brandingResponse.json()).resolves.toMatchObject({ branding: { primaryColor: null } })
    await expect(accountCenterResponse.json()).resolves.toMatchObject({ accountCenter: { sessionsViewEnabled: true } })
    await expect(accountCenterPatch.json()).resolves.toMatchObject({ accountCenter: { sessionsViewEnabled: true } })
  })

  it('exposes admin setup readiness through the management boundary', async () => {
    vi.spyOn(applications, 'listApplications').mockResolvedValue({
      applications: [],
      pagination: { limit: 1, offset: 0, total: 0, hasMore: false, nextOffset: null },
    } as unknown as ListApplicationsResponse)
    vi.spyOn(configz, 'getConfig').mockResolvedValue(readinessConfig())
    const app = createApp(createAuthMock(), createTestDeps())

    const readiness = await app.request('/api/readiness', { headers: adminHeaders() })

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
          href: '/console/sign-in-experience/sign-in',
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
    vi.spyOn(applications, 'listApplications').mockResolvedValue({
      applications: [applicationFixture()],
      pagination: { limit: 1, offset: 0, total: 1, hasMore: false, nextOffset: null },
    } as unknown as ListApplicationsResponse)
    vi.spyOn(configz, 'getConfig').mockResolvedValue(readinessConfig())
    const app = createApp(createAuthMock(), createTestDeps())

    const readiness = await app.request('/api/readiness', { headers: adminHeaders() })

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
    vi.spyOn(applications, 'listApplications').mockResolvedValue({
      applications: [applicationFixture()],
      pagination: { limit: 1, offset: 0, total: 1, hasMore: false, nextOffset: null },
    } as unknown as ListApplicationsResponse)
    vi.spyOn(configz, 'getConfig').mockResolvedValue(
      readinessConfig({
        identityProviders: [],
        signIn: { passwordEnabled: false, emailOtpEnabled: false, socialLoginEnabled: true },
      }),
    )
    const app = createApp(createAuthMock(), createTestDeps())

    const readiness = await app.request('/api/readiness', { headers: adminHeaders() })

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
    vi.spyOn(applications, 'listApplications').mockResolvedValue({
      applications: [applicationFixture()],
      pagination: { limit: 1, offset: 0, total: 1, hasMore: false, nextOffset: null },
    } as unknown as ListApplicationsResponse)
    vi.spyOn(configz, 'getConfig').mockResolvedValue(
      readinessConfig({
        identityProviders: [],
        signIn: { passwordEnabled: false, emailOtpEnabled: false, socialLoginEnabled: true },
      }),
    )
    const app = createApp(createAuthMock(), createTestDeps())

    const readiness = await app.request('/api/readiness', { headers: adminHeaders() })

    expect(readiness.status).toBe(200)
    const body = managementReadinessResponseSchema.parse(await readiness.json())
    expect(body.admin.missing).toEqual(['sign_in_method'])
    expect(body.required.find((item) => item.id === 'sign_in_method')?.status).toBe('action_needed')
    expect(body.recommended.find((item) => item.id === 'connector_status')?.status).toBe('action_needed')
  })
})
