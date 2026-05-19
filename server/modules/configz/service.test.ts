import { describe, expect, it } from 'vitest'
import { type ConfigzRepository, ConfigzService } from './service'

describe('ConfigzService', () => {
  it('composes hosted auth config from defaults without leaking connector secrets', async () => {
    const service = new ConfigzService(createRepository(), {
      issuer: 'https://auth.example.com',
      magicLinkEnabled: true,
      emailOtpEnabled: true,
      usernameEnabled: true,
    })

    await expect(service.getConfig()).resolves.toEqual({
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
      identityProviders: [],
      links: {
        termsUri: null,
        privacyUri: null,
        supportEmail: null,
      },
      copy: {
        productName: 'FlareAuth',
        headline: 'Sign in to FlareAuth',
        description: 'Use your account to continue securely.',
      },
      defaults: {
        applicationId: null,
        redirectUri: null,
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
        magicLinkPath: '/api/auth/sign-in/magic-link',
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
    })
  })

  it('returns configured methods, branding, legal links, copy, defaults, and IdP summaries', async () => {
    const service = new ConfigzService(
      createRepository({
        settings: {
          defaultApplicationId: 'app-1',
          passwordEnabled: false,
          signupEnabled: false,
          socialLoginEnabled: true,
          identifierFirst: true,
          defaultRedirectUri: 'https://client.example.com/callback',
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
      {
        issuer: 'https://auth.example.com',
        magicLinkEnabled: true,
        emailOtpEnabled: true,
        usernameEnabled: true,
      },
    )

    await expect(service.getConfig()).resolves.toMatchObject({
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
      defaults: {
        applicationId: 'app-1',
        redirectUri: 'https://client.example.com/callback',
      },
    })
  })

  it('hides identity providers when social login is disabled', async () => {
    const service = new ConfigzService(
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
      defaultOptions(),
    )

    await expect(service.getConfig()).resolves.toMatchObject({
      signIn: {
        socialLoginEnabled: false,
      },
      identityProviders: [],
    })
  })

  it('reports effective passwordless method availability when signup is disabled', async () => {
    const service = new ConfigzService(
      createRepository({
        settings: {
          ...defaultSettings(),
          signupEnabled: false,
        },
      }),
      defaultOptions(),
    )

    await expect(service.getConfig()).resolves.toMatchObject({
      signIn: {
        signupEnabled: false,
        magicLinkEnabled: false,
        emailOtpEnabled: false,
      },
    })
  })

  it('reports first-run onboarding when no admin exists', async () => {
    const service = new ConfigzService(createRepository(), {
      ...defaultOptions(),
      onboardingRepository: {
        hasUsers: async () => false,
        createBootstrapAdmin: async () => ({ id: 'user-1', email: 'admin@example.com', role: 'admin' }),
      },
    })

    await expect(service.getConfig()).resolves.toMatchObject({
      onboarding: {
        required: true,
        href: '/onboarding',
      },
    })
  })

  it('updates management sign-in settings and returns the normalized resource', async () => {
    const updates: unknown[] = []
    const service = new ConfigzService(
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
      defaultOptions(),
    )

    const response = await service.updateManagementSignInSettings({
      signIn: { passwordEnabled: false, identifierFirst: true },
      defaults: { redirectUri: 'https://app.example.com/callback' },
      links: { supportEmail: 'support@example.com' },
      copy: { productName: 'Acme ID' },
    })

    expect(updates).toEqual([
      {
        passwordEnabled: false,
        identifierFirst: true,
        defaultApplicationId: undefined,
        defaultRedirectUri: 'https://app.example.com/callback',
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

  it('updates management branding settings and returns public branding', async () => {
    const updates: unknown[] = []
    const service = new ConfigzService(
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
      defaultOptions(),
    )

    const response = await service.updateManagementBrandingSettings({
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
      copy: { productName: 'FlareAuth' },
    })
  })

  it('drops unsafe legacy custom CSS from public runtime branding', async () => {
    const service = new ConfigzService(
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
      defaultOptions(),
    )

    await expect(service.getConfig()).resolves.toMatchObject({
      branding: {
        customCss: null,
      },
    })
  })

  it('drops invalid legacy color values from public runtime branding', async () => {
    const service = new ConfigzService(
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
      defaultOptions(),
    )

    await expect(service.getConfig()).resolves.toMatchObject({
      branding: {
        primaryColor: null,
        backgroundColor: null,
      },
    })
  })
})

function defaultOptions() {
  return {
    issuer: 'https://auth.example.com',
    magicLinkEnabled: true,
    emailOtpEnabled: true,
    usernameEnabled: true,
  }
}

function defaultSettings() {
  return {
    defaultApplicationId: null,
    passwordEnabled: true,
    signupEnabled: true,
    socialLoginEnabled: true,
    identifierFirst: false,
    defaultRedirectUri: null,
    termsUri: null,
    privacyUri: null,
    supportEmail: null,
    metadata: null,
  }
}

function createRepository(overrides: Partial<MockData> = {}): ConfigzRepository {
  return {
    getSettings: async () => overrides.settings ?? null,
    getBranding: async () => overrides.branding ?? null,
    listEnabledIdentityProviders: async () => overrides.identityProviders ?? [],
    updateSettings: overrides.updateSettings ?? (async () => undefined),
    updateBranding: overrides.updateBranding ?? (async () => undefined),
  }
}

type MockData = {
  settings: NonNullable<Awaited<ReturnType<ConfigzRepository['getSettings']>>>
  branding: NonNullable<Awaited<ReturnType<ConfigzRepository['getBranding']>>>
  identityProviders: Awaited<ReturnType<ConfigzRepository['listEnabledIdentityProviders']>>
  updateSettings: ConfigzRepository['updateSettings']
  updateBranding: ConfigzRepository['updateBranding']
}
