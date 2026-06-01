import { buildOAuthUserInfoClaims, createAuth, createDeviceAuthorizationOptions } from '@server/auth'
import type {
  DeviceAuthorizationPluginOptions,
  PasskeyPluginOptions,
  TwoFactorPluginOptions,
  UsernamePluginOptions,
} from '@server/auth-test-plugin-types'
import type { Database } from '@server/db/client'
import type { ApplicationAggregate } from '@server/modules/applications/service'
import { deviceCodeGrantType } from '@shared/api/applications'
import type { ManagementSignInSettingsResponse } from '@shared/api/management'
import { describe, expect, it, vi } from 'vitest'

describe('auth.test 3', () => {
  it('maps configured OAuth provider context into customer userinfo claims', async () => {
    const authorization = {
      buildTokenClaims: vi.fn().mockResolvedValue({
        roles: ['member'],
        permissions: ['contacts.read'],
        organization_name: 'Acme',
      }),
    }
    const applications = {
      findByClientId: vi.fn().mockResolvedValue({
        id: 'app-1',
        oidcClaims: {
          accessToken: {},
          idToken: {},
          userInfo: { roles: true, permissions: true, organizationName: true },
        },
      }),
    }

    await expect(
      buildOAuthUserInfoClaims(authorization, applications, {
        clientId: 'client-1',
        user: { id: 'user-1' },
        scopes: ['openid', 'contacts:read'],
        jwt: {
          organization_id: 'org-1',
          aud: 'https://api.example.com/contacts',
        },
      }),
    ).resolves.toEqual({
      roles: ['member'],
      permissions: ['contacts.read'],
      organization_name: 'Acme',
    })

    expect(authorization.buildTokenClaims).toHaveBeenCalledWith({
      userId: 'user-1',
      applicationId: 'app-1',
      organizationId: 'org-1',
      resource: 'https://api.example.com/contacts',
      scopes: ['openid', 'contacts:read'],
      destination: 'userinfo',
      claimSelection: { roles: true, permissions: true, organizationName: true },
    })
  })

  it('configures account profile fields and email changes', () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
    )

    expect(auth.options.user?.changeEmail?.enabled).toBe(true)
    expect(auth.options.user?.additionalFields).toMatchObject({
      username: {
        type: 'string',
        required: false,
        unique: true,
        fieldName: 'username',
      },
      avatarAssetId: {
        type: 'string',
        required: false,
        fieldName: 'avatar_asset_id',
      },
    })
  })

  it('configures username plugin policy', () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
    )

    const plugin = findPlugin<UsernamePluginOptions>(auth, 'username')

    expect(plugin.options.minUsernameLength).toBe(3)
    expect(plugin.options.maxUsernameLength).toBe(64)
    expect(plugin.options.usernameValidator('ada_lovelace-1')).toBe(true)
    expect(plugin.options.usernameValidator('not allowed')).toBe(false)
  })

  it('installs device authorization with the hosted verification page', () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
    )

    expect(findPlugin<DeviceAuthorizationPluginOptions>(auth, 'device-authorization').options).toMatchObject({
      verificationUri: '/device',
    })
  })

  it('rejects ineligible clients and disallowed scopes in device authorization options', async () => {
    const nativeClient = deviceApplication({ clientId: 'native-client' })
    const repository = {
      findByClientId: vi.fn(async (clientId: string) => {
        const applications: Record<string, ApplicationAggregate> = {
          'native-client': nativeClient,
          spa: deviceApplication({ clientId: 'spa', clientType: 'public_spa' }),
          confidential: deviceApplication({
            clientId: 'confidential',
            clientType: 'confidential_web',
            public: false,
          }),
          disabled: deviceApplication({ clientId: 'disabled', disabled: true }),
          'missing-grant': deviceApplication({
            clientId: 'missing-grant',
            allowedGrantTypes: ['authorization_code'],
          }),
        }
        return applications[clientId] ?? null
      }),
    }
    const options = createDeviceAuthorizationOptions(repository)

    await expect(options.validateClient('native-client')).resolves.toBe(true)
    await expect(options.validateClient('spa')).resolves.toBe(false)
    await expect(options.validateClient('confidential')).resolves.toBe(false)
    await expect(options.validateClient('disabled')).resolves.toBe(false)
    await expect(options.validateClient('missing-grant')).resolves.toBe(false)
    await expect(options.onDeviceAuthRequest('native-client', 'openid email')).resolves.toBeUndefined()
    await expect(options.onDeviceAuthRequest('native-client', 'openid management:read')).rejects.toMatchObject({
      status: 'BAD_REQUEST',
      body: {
        error: 'invalid_request',
        error_description: 'Scope is not allowed for this client: management:read',
      },
    })
    await expect(options.onDeviceAuthRequest('disabled', 'openid')).rejects.toMatchObject({
      status: 'BAD_REQUEST',
      body: {
        error: 'invalid_client',
      },
    })
  })

  it('configures deployment security policy for sessions and passkeys', () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy({
        passkeys: {
          enabled: true,
          rpId: 'auth.example.com',
          rpName: 'Example Auth',
          origins: ['https://auth.example.com', 'https://preview.example.workers.dev'],
        },
        sessions: {
          expiresInSeconds: 3600,
          updateAgeSeconds: 300,
          freshAgeSeconds: 600,
          cookieCacheSeconds: 60,
        },
      }),
    )

    expect(auth.options.session).toMatchObject({
      expiresIn: 3600,
      updateAge: 300,
      freshAge: 600,
      cookieCache: {
        enabled: true,
        maxAge: 60,
      },
    })
    expect(findPlugin<PasskeyPluginOptions>(auth, 'passkey').options).toMatchObject({
      rpID: 'auth.example.com',
      rpName: 'Example Auth',
      origin: ['https://auth.example.com', 'https://preview.example.workers.dev'],
    })
    expect(findPlugin<TwoFactorPluginOptions>(auth, 'two-factor').options).toMatchObject({
      issuer: 'FlareAuth',
      allowPasswordless: true,
      totpOptions: {
        disable: false,
      },
    })
  })

  it('disables TOTP when authenticator app MFA is disabled by deployment policy', () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy({
        mfa: {
          mode: 'optional',
          authenticatorAppEnabled: false,
          emailOtpEnabled: false,
          backupCodesEnabled: true,
        },
      }),
    )

    expect(findPlugin<TwoFactorPluginOptions>(auth, 'two-factor').options.totpOptions).toMatchObject({
      disable: true,
    })
  })

  it('only exposes two-factor email OTP when the MFA email OTP method is explicitly enabled', () => {
    const defaultAuth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
    )
    const emailOtpAuth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
      undefined,
      { twoFactorEmailOtpEnabled: true },
    )
    const totpOnlyAuth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
      undefined,
      { twoFactorEmailOtpEnabled: false },
    )

    expect(findPlugin<TwoFactorPluginOptions>(defaultAuth, 'two-factor').options.otpOptions).toBeUndefined()
    expect(findPlugin<TwoFactorPluginOptions>(emailOtpAuth, 'two-factor').options.otpOptions).toBeTruthy()
    expect(findPlugin<TwoFactorPluginOptions>(totpOnlyAuth, 'two-factor').options.otpOptions).toBeUndefined()
  })
})

function createEmailSenderMock() {
  return {
    send: vi.fn().mockResolvedValue({ messageId: 'email-1' }),
  }
}

function createSecurityPolicy(overrides: Partial<SecurityPolicyInput> = {}) {
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
      minLength: 8,
      requiredCharacterTypes: 1,
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
  } satisfies SecurityPolicyInput
}

function _createBuiltInProviders(
  phoneOverrides: Partial<ManagementSignInSettingsResponse['builtInProviders']['phone']> = {},
): ManagementSignInSettingsResponse['builtInProviders'] {
  return {
    email: {
      enabled: true,
      otpLength: 8,
      expiresInSeconds: 900,
    },
    phone: {
      enabled: true,
      otpLength: 6,
      expiresInSeconds: 300,
      signUpOnVerification: false,
      requireVerification: true,
      smsProvider: 'twilio',
      twilioAccountSid: 'twilio-sid',
      twilioAuthToken: 'twilio-token',
      twilioFromNumber: '+15555550100',
      vonageApiKey: '',
      vonageApiSecret: '',
      vonageFrom: '',
      messageBirdAccessKey: '',
      messageBirdOriginator: '',
      ...phoneOverrides,
    },
    web3Wallet: {
      enabled: true,
      chains: [1],
      domain: 'wallet.example.com',
      emailDomainName: 'wallet.example.com',
      ensLookupEnabled: false,
      allowSignUp: true,
    },
    passkey: {
      allowSignUp: true,
    },
    oneTap: {
      enabled: true,
      clientId: 'google-client-id',
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

interface SecurityPolicyInput {
  mfa: {
    mode: 'optional' | 'required'
    authenticatorAppEnabled?: boolean
    emailOtpEnabled?: boolean
    backupCodesEnabled?: boolean
  }
  passkeys: {
    enabled: boolean
    rpId: string
    rpName: string
    origins: string[]
  }
  sessions: {
    expiresInSeconds: number
    updateAgeSeconds: number
    freshAgeSeconds: number
    cookieCacheSeconds: number
  }
  password: {
    minLength: number
    requiredCharacterTypes: number
    customWords: string[]
    rejectUserInfo: boolean
    rejectSequential: boolean
    rejectCustomWords: boolean
  }
  captcha: {
    enabled: boolean
    provider: 'turnstile'
    siteKey: string
    secretBinding: string
  }
  blocklist: {
    blockSubaddressing: boolean
    entries: string[]
  }
}

function _jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deviceApplication(overrides: Partial<ApplicationAggregate> = {}): ApplicationAggregate {
  return {
    id: 'app-1',
    slug: 'native-client',
    name: 'Native Client',
    description: null,
    homepageUrl: null,
    iconUrl: null,
    clientId: 'native-client',
    clientType: 'public_native',
    public: true,
    firstParty: false,
    trusted: false,
    systemManaged: false,
    disabled: false,
    disabledReason: null,
    redirectUris: ['com.example.native:/callback'],
    postLogoutRedirectUris: [],
    corsOrigins: [],
    customData: {},
    allowedGrantTypes: ['authorization_code', deviceCodeGrantType],
    allowedScopes: ['openid', 'profile', 'email'],
    requirePkce: true,
    tokenEndpointAuthMethod: 'none',
    oidcClaims: {
      accessToken: {},
      idToken: {},
      userInfo: {},
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function findPlugin<TOptions extends object>(auth: ReturnType<typeof createAuth>, id: string) {
  const plugin = auth.options.plugins?.find((candidate) => candidate.id === id)

  if (!plugin) {
    throw new Error(`Plugin not found: ${id}`)
  }

  return plugin as unknown as { options: TOptions }
}
