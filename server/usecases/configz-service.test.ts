import type { ConfigzOptions } from '@server/usecases/configz'
import {
  defaultAccountCenterSettings,
  getConfig,
  getManagementEmailSettings,
  getManagementGeneralSettings,
  updateManagementAccountCenterSettings,
  updateManagementBrandingSettings,
  updateManagementEmailSettings,
  updateManagementGeneralSettings,
  updateManagementSignInSettings,
} from '@server/usecases/configz'
import type { Deps } from '@server/usecases/deps'
import type { ConfigzRepository, ConnectorRecord } from '@server/usecases/ports'
import { describe, expect, it } from 'vitest'

describe('ConfigzService', () => {
  it('composes hosted auth config without leaking connector secrets', async () => {
    const deps = createDeps(createRepository(), { onboardingHasUsers: true })
    const options = {
      issuer: 'https://auth.example.com',
      emailOtpEnabled: true,
      usernameEnabled: true,
    }

    await expect(getConfig(deps, options)).resolves.toEqual({
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
      builtInProviders: {
        email: { enabled: true },
        phone: { enabled: false },
        web3Wallet: { enabled: false, chains: [1], allowSignUp: true },
        passkey: { allowSignUp: true },
        oneTap: {
          enabled: false,
          clientId: '',
          autoSelect: false,
          cancelOnTapOutside: true,
          uxMode: 'popup',
          context: 'signin',
          promptBaseDelayMs: 1000,
          promptMaxAttempts: 5,
        },
      },
      branding: {
        logoUrl: null,
        faviconUrl: null,
        primaryColor: null,
        backgroundColor: null,
        customCss: null,
      },
      identityProviders: [],
      links: {
        termsUri: null,
        privacyUri: null,
        supportEmail: null,
      },
      copy: {
        productName: 'Realmroot',
        headline: 'Sign in to Realmroot',
        description: 'Use your account to continue securely.',
      },
      auth: {
        basePath: '/api/auth',
        signInEmailPath: '/api/auth/sign-in/email',
        signInUsernamePath: '/api/auth/sign-in/username',
        signUpEmailPath: '/api/auth/sign-up/email',
        signOutPath: '/api/auth/sign-out',
        requestPasswordResetPath: '/api/auth/request-password-reset',
        resetPasswordPath: '/api/auth/reset-password',
        sendVerificationEmailPath: '/api/auth/send-verification-email',
        verifyEmailPath: '/api/auth/verify-email',
        emailOtpPath: '/api/auth/email-otp/send-verification-otp',
        emailOtpSignInPath: '/api/auth/sign-in/email-otp',
        emailOtpVerificationPath: '/api/auth/email-otp/verify-email',
        emailOtpPasswordResetRequestPath: '/api/auth/email-otp/request-password-reset',
        emailOtpPasswordResetPath: '/api/auth/email-otp/reset-password',
      },
      oidc: {
        issuer: 'https://auth.example.com/api/auth',
        discoveryUrl: 'https://auth.example.com/api/auth/.well-known/openid-configuration',
        authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
        deviceAuthorizationEndpoint: 'https://auth.example.com/api/auth/device/code',
        tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
        jwksUri: 'https://auth.example.com/api/auth/jwks',
        userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
        endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/end-session',
      },
      security: {
        mfaRequired: false,
        sessionExpiresInSeconds: 0,
        passkeysEnabled: false,
      },
      accountCenter: defaultAccountCenterSettings,
      captcha: {
        enabled: false,
        provider: 'turnstile',
        siteKey: '',
      },
    })
  })

  it('returns configured methods, branding, legal links, copy, and IdP summaries', async () => {
    const deps = createDeps(
      createRepository({
        settings: {
          passwordEnabled: false,
          signupEnabled: false,
          socialLoginEnabled: true,
          identifierFirst: true,
          termsUri: 'https://auth.example.com/terms',
          privacyUri: 'https://auth.example.com/privacy',
          supportEmail: 'support@example.com',
          metadata: {
            copy: {
              productName: 'Example ID',
              headline: 'Welcome back',
              description: 'Continue to your workspace.',
            },
          },
        },
        branding: {
          logoUrl: 'https://cdn.example.com/logo.png',
          logoAssetUrl: null,
          faviconUrl: 'https://cdn.example.com/favicon.ico',
          faviconAssetUrl: null,
          primaryColor: '#2563eb',
          backgroundColor: '#ffffff',
          customCss: '--auth-panel-radius: 8px;',
        },
        identityProviders: [
          {
            slug: 'google',
            providerType: 'oauth2',
            providerId: 'google',
            displayName: 'Google',
            icon: 'google',
          },
        ],
      }),
      { onboardingHasUsers: true, enabledConnectors: [enabledConnector('google')] },
    )

    await expect(getConfig(deps, defaultOptions())).resolves.toMatchObject({
      signIn: {
        passwordEnabled: false,
        signupEnabled: false,
        identifierFirst: true,
      },
      branding: {
        logoUrl: 'https://cdn.example.com/logo.png',
        faviconUrl: 'https://cdn.example.com/favicon.ico',
      },
      identityProviders: [
        {
          slug: 'google',
          providerType: 'oauth2',
          providerId: 'google',
          displayName: 'Google',
        },
      ],
      links: {
        termsUri: 'https://auth.example.com/terms',
        privacyUri: 'https://auth.example.com/privacy',
        supportEmail: 'support@example.com',
      },
      copy: {
        productName: 'Example ID',
        headline: 'Welcome back',
        description: 'Continue to your workspace.',
      },
    })
  })

  it('hides identity providers when social login is disabled', async () => {
    const deps = createDeps(
      createRepository({
        settings: {
          ...defaultSettings(),
          socialLoginEnabled: false,
        },
        identityProviders: [
          {
            slug: 'google',
            providerType: 'oauth2',
            providerId: 'google',
            displayName: 'Google',
            icon: 'google',
          },
        ],
      }),
      { onboardingHasUsers: true, enabledConnectors: [enabledConnector('google')] },
    )

    await expect(getConfig(deps, defaultOptions())).resolves.toMatchObject({
      signIn: {
        socialLoginEnabled: false,
      },
      identityProviders: [],
    })
  })

  it('only exposes identity providers that are available to the auth runtime', async () => {
    const deps = createDeps(
      createRepository({
        identityProviders: [
          {
            slug: 'github',
            providerType: 'social',
            providerId: 'github',
            displayName: 'GitHub',
            icon: 'github',
          },
          {
            slug: 'google',
            providerType: 'social',
            providerId: 'google',
            displayName: 'Google',
            icon: 'google',
          },
        ],
      }),
      { onboardingHasUsers: true, enabledConnectors: [enabledConnector('google')] },
    )

    await expect(getConfig(deps, defaultOptions())).resolves.toMatchObject({
      identityProviders: [
        {
          slug: 'google',
          providerType: 'social',
          providerId: 'google',
          displayName: 'Google',
        },
      ],
    })
  })

  it('reports effective passwordless method availability when signup is disabled', async () => {
    const deps = createDeps(
      createRepository({
        settings: {
          ...defaultSettings(),
          signupEnabled: false,
        },
      }),
      { onboardingHasUsers: true },
    )

    await expect(getConfig(deps, defaultOptions())).resolves.toMatchObject({
      signIn: {
        signupEnabled: false,
        emailOtpEnabled: true,
      },
    })
  })

  it('reports first-run onboarding when no admin exists', async () => {
    const deps = createDeps(createRepository(), { onboardingHasUsers: false })

    await expect(getConfig(deps, defaultOptions())).resolves.toMatchObject({
      onboarding: {
        required: true,
        href: '/onboarding',
      },
    })
  })

  it('updates management sign-in settings and returns the normalized resource', async () => {
    const updates: unknown[] = []
    const deps = createDeps(
      createRepository({
        settings: {
          ...defaultSettings(),
          metadata: {
            copy: {
              productName: 'Existing ID',
              headline: 'Existing headline',
              description: 'Existing description.',
            },
          },
        },
        updateSettings: async (input) => {
          updates.push(input)
        },
      }),
      { onboardingHasUsers: true },
    )

    const response = await updateManagementSignInSettings(deps, defaultOptions(), {
      signIn: { passwordEnabled: false, usernameEnabled: false, identifierFirst: true },
      links: { supportEmail: 'support@example.com' },
      copy: { productName: 'Acme ID' },
    })

    expect(updates).toEqual([
      {
        passwordEnabled: false,
        usernameEnabled: false,
        identifierFirst: true,
        termsUri: undefined,
        privacyUri: undefined,
        supportEmail: 'support@example.com',
        copy: { productName: 'Acme ID' },
      },
    ])
    expect(response).toMatchObject({
      signIn: { passwordEnabled: true },
      copy: {
        productName: 'Existing ID',
        headline: 'Existing headline',
        description: 'Existing description.',
      },
    })
  })

  it('uses the managed username sign-in setting before the deployment default', async () => {
    const deps = createDeps(
      createRepository({
        settings: { ...defaultSettings(), metadata: { usernameEnabled: false, emailOtpEnabled: false } },
      }),
      { onboardingHasUsers: true },
    )

    await expect(getConfig(deps, { ...defaultOptions(), usernameEnabled: true })).resolves.toMatchObject({
      signIn: { usernameEnabled: false, emailOtpEnabled: false },
      builtInProviders: { email: { enabled: false } },
    })
  })

  it('updates management branding settings and returns public branding', async () => {
    const updates: unknown[] = []
    const deps = createDeps(
      createRepository({
        branding: {
          logoUrl: null,
          logoAssetUrl: 'https://cdn.example.com/logo-asset.svg',
          faviconUrl: null,
          faviconAssetUrl: 'https://cdn.example.com/favicon-asset.ico',
          primaryColor: '#b42318',
          backgroundColor: '#f7f3ee',
          customCss: null,
        },
        updateBranding: async (input) => {
          updates.push(input)
        },
      }),
      { onboardingHasUsers: true },
    )

    const response = await updateManagementBrandingSettings(deps, defaultOptions(), {
      branding: {
        logoUrl: 'https://cdn.example.com/logo.svg',
        customCss: '--auth-panel-radius: 8px;',
      },
      copy: { headline: 'Welcome' },
    })

    expect(updates).toEqual([
      {
        logoUrl: 'https://cdn.example.com/logo.svg',
        customCss: '--auth-panel-radius: 8px;',
        copy: { headline: 'Welcome' },
      },
    ])
    expect(response).toMatchObject({
      branding: {
        logoUrl: 'https://cdn.example.com/logo-asset.svg',
        faviconUrl: 'https://cdn.example.com/favicon-asset.ico',
      },
      copy: { productName: 'Realmroot' },
    })
  })

  it('updates management account center settings and returns the normalized resource', async () => {
    let accountCenter = {
      ...defaultAccountCenterSettings,
      sessionsViewEnabled: true,
      emailChangeEnabled: true,
    }
    const updates: unknown[] = []
    const deps = createDeps(
      createRepository({
        getAccountCenterSettings: async () => accountCenter,
        updateAccountCenterSettings: async (input) => {
          updates.push(input)
          accountCenter = { ...accountCenter, ...input }
        },
      }),
      { onboardingHasUsers: true },
    )

    const response = await updateManagementAccountCenterSettings(deps, defaultOptions(), {
      accountCenter: { sessionsViewEnabled: false, emailChangeEnabled: false },
    })

    expect(updates).toEqual([{ sessionsViewEnabled: false, emailChangeEnabled: false }])
    expect(response).toEqual({
      accountCenter: {
        ...defaultAccountCenterSettings,
        sessionsViewEnabled: false,
        emailChangeEnabled: false,
      },
    })
  })

  it('drops unsafe legacy custom CSS from public runtime branding', async () => {
    const deps = createDeps(
      createRepository({
        branding: {
          logoUrl: null,
          logoAssetUrl: null,
          faviconUrl: null,
          faviconAssetUrl: null,
          primaryColor: '#b42318',
          backgroundColor: '#f7f3ee',
          customCss: '.authPanel { display: none; }',
        },
      }),
      { onboardingHasUsers: true },
    )

    await expect(getConfig(deps, defaultOptions())).resolves.toMatchObject({
      branding: {
        customCss: null,
      },
    })
  })

  it('drops invalid legacy color values from public runtime branding', async () => {
    const deps = createDeps(
      createRepository({
        branding: {
          logoUrl: null,
          logoAssetUrl: null,
          faviconUrl: null,
          faviconAssetUrl: null,
          primaryColor: 'red',
          backgroundColor: 'var(--color)',
          customCss: null,
        },
      }),
      { onboardingHasUsers: true },
    )

    await expect(getConfig(deps, defaultOptions())).resolves.toMatchObject({
      branding: {
        primaryColor: null,
        backgroundColor: null,
      },
    })
  })

  it('[spec: admin-console/admin-general-settings] persists the Realm name and derives protocol endpoints', async () => {
    let updated: Parameters<ConfigzRepository['updateSettings']>[0] | null = null
    const repository = createRepository({
      settings: { ...defaultSettings(), metadata: { copy: { productName: 'Acme Realm' } } },
      updateSettings: async (input) => {
        updated = input
      },
    })
    const deps = createDeps(repository, { onboardingHasUsers: true })

    await expect(getManagementGeneralSettings(deps, defaultOptions())).resolves.toEqual({
      realmName: 'Acme Realm',
      issuer: 'https://auth.example.com/api/auth',
      oidcDiscoveryUrl: 'https://auth.example.com/api/auth/.well-known/openid-configuration',
      jwksUrl: 'https://auth.example.com/api/auth/jwks',
      managementApiUrl: 'https://auth.example.com/api/openapi.json',
    })
    await updateManagementGeneralSettings(deps, defaultOptions(), { realmName: 'New Realm' })
    expect(updated).toEqual({ copy: { productName: 'New Realm' } })
  })

  it('[spec: admin-console/admin-email-delivery-settings] persists email delivery separately from its binding', async () => {
    let stored: Awaited<ReturnType<ConfigzRepository['getEmailSettings']>> = null
    const repository = createRepository({
      getEmailSettings: async () => stored,
      updateEmailSettings: async (input) => {
        stored = input
      },
    })
    const deps = createDeps(repository, { onboardingHasUsers: true })
    const options = {
      ...defaultOptions(),
      emailDelivery: {
        bindingAvailable: true,
        fromEmail: 'fallback@example.com',
        fromName: 'Fallback',
      },
    }

    await expect(getManagementEmailSettings(deps, options)).resolves.toMatchObject({
      enabled: true,
      fromEmail: 'fallback@example.com',
      bindingAvailable: true,
      source: 'environment',
    })
    await expect(
      updateManagementEmailSettings(deps, options, {
        provider: 'cloudflare_email',
        enabled: true,
        fromEmail: 'auth@example.com',
        fromName: 'Acme Realm',
        replyToEmail: 'support@example.com',
      }),
    ).resolves.toMatchObject({
      enabled: true,
      fromEmail: 'auth@example.com',
      fromName: 'Acme Realm',
      replyToEmail: 'support@example.com',
      source: 'database',
    })
    await expect(
      updateManagementEmailSettings(
        deps,
        { ...defaultOptions(), emailDelivery: { bindingAvailable: false } },
        {
          provider: 'cloudflare_email',
          enabled: true,
          fromEmail: 'auth@example.com',
          fromName: null,
          replyToEmail: null,
        },
      ),
    ).rejects.toThrow('Cloudflare Email binding is not available')
  })
})

function defaultOptions(): ConfigzOptions {
  return {
    issuer: 'https://auth.example.com',
    emailOtpEnabled: true,
    usernameEnabled: true,
  }
}

function defaultSettings() {
  return {
    passwordEnabled: true,
    signupEnabled: true,
    socialLoginEnabled: true,
    identifierFirst: false,
    termsUri: null,
    privacyUri: null,
    supportEmail: null,
    metadata: null,
  }
}

function createDeps(
  repository: ConfigzRepository,
  options: { onboardingHasUsers: boolean; enabledConnectors?: ConnectorRecord[] },
): Deps {
  return {
    configz: repository,
    onboarding: { hasUsers: async () => options.onboardingHasUsers },
    connectors: { listEnabled: async () => options.enabledConnectors ?? [] },
  } as unknown as Deps
}

function enabledConnector(providerId: string): ConnectorRecord {
  const now = new Date('2026-05-18T00:00:00.000Z')
  return {
    id: `idp_${providerId}`,
    slug: providerId,
    providerType: 'social',
    providerId,
    displayName: providerId,
    enabled: true,
    loginEnabled: true,
    clientId: 'client-id',
    clientSecret: 'client-secret',
    clientSecretContext: null,
    issuer: null,
    authorizationEndpoint: null,
    tokenEndpoint: null,
    userInfoEndpoint: null,
    jwksEndpoint: null,
    registrationEndpoint: null,
    revocationEndpoint: null,
    registrationMode: null,
    registrationAccessToken: null,
    registrationAccessTokenContext: null,
    scopes: null,
    attributeMapping: null,
    providerMetadata: null,
    createdAt: now,
    updatedAt: now,
  }
}

function createRepository(overrides: Partial<MockData> = {}): ConfigzRepository {
  return {
    getSettings: async () => overrides.settings ?? null,
    getBranding: async () => overrides.branding ?? null,
    getAccountCenterSettings: overrides.getAccountCenterSettings ?? (async () => overrides.accountCenter ?? null),
    getDeveloperSettings:
      overrides.getDeveloperSettings ??
      (async () => ({
        organizationCreation: 'admins_only',
        approvedUserIds: [],
        consoleAccess: 'realm_operators',
        eligibleAccessLevels: ['owner', 'admin'],
        selectedOrganizationIds: [],
      })),
    getEmailSettings: overrides.getEmailSettings ?? (async () => null),
    listEnabledIdentityProviders: async () => overrides.identityProviders ?? [],
    updateSettings: overrides.updateSettings ?? (async () => undefined),
    updateBranding: overrides.updateBranding ?? (async () => undefined),
    updateAccountCenterSettings: overrides.updateAccountCenterSettings ?? (async () => undefined),
    updateDeveloperSettings: overrides.updateDeveloperSettings ?? (async () => undefined),
    updateEmailSettings: overrides.updateEmailSettings ?? (async () => undefined),
  }
}

type MockData = {
  settings: NonNullable<Awaited<ReturnType<ConfigzRepository['getSettings']>>>
  branding: NonNullable<Awaited<ReturnType<ConfigzRepository['getBranding']>>>
  identityProviders: Awaited<ReturnType<ConfigzRepository['listEnabledIdentityProviders']>>
  accountCenter: NonNullable<Awaited<ReturnType<ConfigzRepository['getAccountCenterSettings']>>>
  getAccountCenterSettings: ConfigzRepository['getAccountCenterSettings']
  getDeveloperSettings: ConfigzRepository['getDeveloperSettings']
  getEmailSettings: ConfigzRepository['getEmailSettings']
  updateSettings: ConfigzRepository['updateSettings']
  updateBranding: ConfigzRepository['updateBranding']
  updateAccountCenterSettings: ConfigzRepository['updateAccountCenterSettings']
  updateDeveloperSettings: ConfigzRepository['updateDeveloperSettings']
  updateEmailSettings: ConfigzRepository['updateEmailSettings']
}
