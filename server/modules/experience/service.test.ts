import { describe, expect, it } from 'vitest'
import { type ExperienceRepository, ExperienceService } from './service'

describe('ExperienceService', () => {
  it('composes hosted auth config from defaults without leaking connector secrets', async () => {
    const service = new ExperienceService(createRepository(), {
      issuer: 'https://auth.example.com',
      magicLinkEnabled: true,
      emailOtpEnabled: true,
      usernameEnabled: true,
    })

    await expect(service.getConfig()).resolves.toEqual({
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
    })
  })

  it('returns configured methods, branding, legal links, copy, defaults, and IdP summaries', async () => {
    const service = new ExperienceService(
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
          faviconUrl: 'https://cdn.example.com/favicon.ico',
          primaryColor: '#2563eb',
          backgroundColor: '#ffffff',
          customCss: '.brand { color: #2563eb; }',
        },
        identityProviders: [
          {
            slug: 'google',
            providerType: 'oauth2',
            providerId: 'google',
            displayName: 'Google',
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
          displayName: 'Google',
          authorizationUrl: 'https://auth.example.com/api/auth/sign-in/social?provider=google',
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
    const service = new ExperienceService(
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
    const service = new ExperienceService(
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

  it('normalizes OAuth callback errors without validating redirect data', async () => {
    const service = new ExperienceService(createRepository(), defaultOptions())

    await expect(
      service.getCallbackState({
        client_id: 'missing-client',
        redirect_uri: 'https://evil.example.com/callback',
        state: 'state-1',
        error: 'access_denied',
        error_description: 'The user denied consent.',
      }),
    ).resolves.toEqual({
      state: 'state-1',
      returnTo: 'https://evil.example.com/callback',
      error: {
        code: 'access_denied',
        description: 'The user denied consent.',
      },
      consent: null,
    })
  })

  it('returns neutral callback state when no OAuth query is present', async () => {
    const service = new ExperienceService(createRepository(), defaultOptions())

    await expect(service.getCallbackState({ return_to: '/dashboard' })).resolves.toEqual({
      state: null,
      returnTo: '/dashboard',
      error: null,
      consent: null,
    })
  })

  it('rejects partial OAuth callback query state', async () => {
    const service = new ExperienceService(createRepository(), defaultOptions())

    await expect(service.getCallbackState({ client_id: 'client-1' })).rejects.toMatchObject({
      status: 400,
      code: 'bad_request',
      message: 'client_id and redirect_uri are both required for OAuth callback state.',
    })
  })

  it('rejects missing or disabled OAuth callback clients', async () => {
    const missingService = new ExperienceService(createRepository(), defaultOptions())
    const disabledService = new ExperienceService(
      createRepository({
        application: {
          id: 'app-1',
          clientId: 'client-1',
          redirectUris: ['https://client.example.com/callback'],
          disabled: true,
        },
      }),
      defaultOptions(),
    )

    await expect(
      missingService.getCallbackState({
        client_id: 'client-1',
        redirect_uri: 'https://client.example.com/callback',
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'OAuth client was not found.',
    })
    await expect(
      disabledService.getCallbackState({
        client_id: 'client-1',
        redirect_uri: 'https://client.example.com/callback',
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'OAuth client was not found.',
    })
  })

  it('validates OAuth callback client redirect before returning consent handoff', async () => {
    const service = new ExperienceService(
      createRepository({
        application: {
          id: 'app-1',
          clientId: 'client-1',
          redirectUris: ['https://client.example.com/callback'],
          disabled: false,
        },
      }),
      defaultOptions(),
    )

    await expect(
      service.getCallbackState({
        client_id: 'client-1',
        redirect_uri: 'https://client.example.com/callback',
        state: 'state-1',
      }),
    ).resolves.toEqual({
      state: 'state-1',
      returnTo: 'https://client.example.com/callback',
      error: null,
      consent: {
        clientId: 'client-1',
        redirectUri: 'https://client.example.com/callback',
        href: '/oauth/consent?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
      },
    })
  })

  it('rejects unregistered OAuth callback redirects', async () => {
    const service = new ExperienceService(
      createRepository({
        application: {
          id: 'app-1',
          clientId: 'client-1',
          redirectUris: ['https://client.example.com/callback'],
          disabled: false,
        },
      }),
      defaultOptions(),
    )

    await expect(
      service.getCallbackState({
        client_id: 'client-1',
        redirect_uri: 'https://evil.example.com/callback',
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'bad_request',
      message: 'redirect_uri is not registered for this client.',
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

function createRepository(overrides: Partial<MockData> = {}): ExperienceRepository {
  return {
    getSettings: async () => overrides.settings ?? null,
    getBranding: async () => overrides.branding ?? null,
    listEnabledIdentityProviders: async () => overrides.identityProviders ?? [],
    findApplicationByClientId: async (clientId) =>
      overrides.application?.clientId === clientId ? overrides.application : null,
  }
}

type MockData = {
  settings: NonNullable<Awaited<ReturnType<ExperienceRepository['getSettings']>>>
  branding: NonNullable<Awaited<ReturnType<ExperienceRepository['getBranding']>>>
  identityProviders: Awaited<ReturnType<ExperienceRepository['listEnabledIdentityProviders']>>
  application: NonNullable<Awaited<ReturnType<ExperienceRepository['findApplicationByClientId']>>>
}
