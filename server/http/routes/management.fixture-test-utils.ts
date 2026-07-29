import type { SecurityPolicy } from '@shared/api/security'
import { vi } from 'vitest'

export function securityPolicy(overrides: Partial<SecurityPolicy> = {}): SecurityPolicy {
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

export function updatedSecurityPolicy(): SecurityPolicy {
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

export function createConfigzServiceMock(
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
        endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/end-session',
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

export function builtInProvidersFixture() {
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

export function createConnectorServiceMock() {
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

export function createWebhookServiceMock() {
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

export function webhookEndpointResponse() {
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

export function webhookRequestResponse() {
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

export function connectorFixture() {
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

export function applicationFixture() {
  return {
    id: 'app-1',
    slug: 'customer-portal',
    name: 'Customer portal',
    clientId: 'client-1',
    clientType: 'public_spa',
    redirectUris: ['https://app.example.com/callback'],
    systemManaged: false,
    disabled: false,
  }
}

export function createPage(page: { limit: number; offset: number }) {
  return {
    items: [],
    total: 10,
    ...page,
  }
}

export function adminHeaders() {
  return {
    'content-type': 'application/json',
    'x-user-id': 'admin-1',
    'x-user-role': 'admin',
  }
}

export function userHeaders() {
  return {
    'content-type': 'application/json',
    'x-user-id': 'user-1',
    'x-user-role': 'user',
  }
}

export function bearerHeaders(token: string) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  }
}
