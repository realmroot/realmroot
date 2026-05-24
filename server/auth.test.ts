import { describe, expect, it, vi } from 'vitest'
import type { ManagementSignInSettingsResponse } from '../shared/api/management'
import { createApp } from './app'
import { buildOAuthAccessTokenClaims, createAuth } from './auth'
import type { Database } from './db/client'

describe('createAuth OAuth Provider metadata', () => {
  it('serves OIDC discovery from the mounted Better Auth issuer', async () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
    )

    const response = await createApp(auth).request('/api/auth/.well-known/openid-configuration')

    expect(response.status).toBe(200)
    const metadata = (await response.json()) as {
      token_endpoint_auth_methods_supported: string[]
    }

    expect(metadata).toMatchObject({
      issuer: 'https://auth.example.com/api/auth',
      authorization_endpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
      token_endpoint: 'https://auth.example.com/api/auth/oauth2/token',
      jwks_uri: 'https://auth.example.com/api/auth/jwks',
      grant_types_supported: ['authorization_code', 'client_credentials', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'profile', 'email', 'offline_access', 'management:read', 'management:write'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    })
    expect(metadata.token_endpoint_auth_methods_supported).not.toContain('none')
  })

  it('wires Better Auth email flows to the transactional email sender', async () => {
    const emailSender = createEmailSenderMock()
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      emailSender,
      createSecurityPolicy(),
    )

    await auth.options.emailVerification?.sendVerificationEmail?.({
      user: createUser(),
      url: 'https://auth.example.com/verify',
      token: 'verification-token',
    })
    await auth.options.emailAndPassword?.sendResetPassword?.({
      user: createUser(),
      url: 'https://auth.example.com/reset',
      token: 'reset-token',
    })
    await auth.options.emailAndPassword?.onPasswordReset?.({
      user: createUser(),
    })
    await findPlugin<EmailOtpPluginOptions>(auth, 'email-otp').options.sendVerificationOTP({
      email: 'user@example.com',
      otp: '123456',
      type: 'sign-in',
    })
    await findPlugin<OrganizationPluginOptions>(auth, 'organization').options.sendInvitationEmail({
      email: 'user@example.com',
      id: 'invitation-1',
      inviter: {
        user: createUser(),
      },
    })

    expect(emailSender.send).toHaveBeenCalledWith({
      to: 'user@example.com',
      template: {
        type: 'verification',
        url: 'https://auth.example.com/verify',
      },
    })
    expect(emailSender.send).toHaveBeenCalledWith({
      to: 'user@example.com',
      template: {
        type: 'password-reset',
        url: 'https://auth.example.com/reset',
      },
    })
    expect(emailSender.send).toHaveBeenCalledWith({
      to: 'user@example.com',
      template: {
        type: 'security-notification',
        title: 'Your password was changed',
        body: 'Your FlareAuth password was changed. If this was not you, reset your password immediately.',
      },
    })
    expect(emailSender.send).toHaveBeenCalledWith({
      to: 'user@example.com',
      template: {
        type: 'otp',
        otp: '123456',
      },
    })
    expect(emailSender.send).toHaveBeenCalledWith({
      to: 'user@example.com',
      template: {
        type: 'invitation',
        inviterName: 'User',
        url: 'https://auth.example.com/organization/accept-invitation?id=invitation-1',
      },
    })
  })

  it('exposes security, email OTP, username, and organization invitation APIs', () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
    )

    expect(Object.keys(auth.api)).toEqual(
      expect.arrayContaining([
        'enableTwoFactor',
        'verifyTOTP',
        'listPasskeys',
        'generatePasskeyRegistrationOptions',
        'sendVerificationOTP',
        'requestPasswordResetEmailOTP',
        'signInUsername',
        'isUsernameAvailable',
        'createInvitation',
      ]),
    )
    expect(Object.keys(auth.api)).not.toEqual(
      expect.arrayContaining(['createTeam', 'listOrganizationTeams', 'setActiveTeam', 'addTeamMember']),
    )
  })

  it('configures organization access control with teams disabled', () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
    )

    const organizationPlugin = auth.options.plugins?.find((plugin) => plugin.id === 'organization')

    expect(organizationPlugin?.options).toMatchObject({
      teams: {
        enabled: false,
      },
      dynamicAccessControl: {
        enabled: true,
      },
    })
  })

  it('limits management userinfo claims to the system CLI client', () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
    )
    const oauth = findPlugin<OAuthProviderPluginOptions>(auth, 'oauth-provider').options
    const user = { ...createUser(), role: 'admin' }
    const jwt = {
      scope: 'openid management:read',
      authorization: { roles: ['admin'] },
      roles: ['admin'],
    }

    expect(oauth.clientRegistrationAllowedScopes).toEqual(['openid', 'profile', 'email', 'offline_access'])
    expect(
      oauth.customUserInfoClaims({
        user,
        scopes: ['openid', 'management:read'],
        jwt: { ...jwt, client_id: 'customer-client' },
      }),
    ).toEqual({})
    expect(
      oauth.customUserInfoClaims({
        user,
        scopes: ['openid', 'management:read'],
        jwt: { ...jwt, azp: 'flareauth-cli' },
      }),
    ).toEqual({
      role: 'admin',
      scope: 'openid management:read',
      client_id: 'flareauth-cli',
      authorization: { roles: ['admin'] },
      roles: ['admin'],
    })
  })

  it('maps OAuth provider context into authorization token claims', async () => {
    const authorization = {
      buildTokenClaims: vi.fn().mockResolvedValue({
        authorization: {
          roles: ['contacts-reader'],
        },
      }),
    }

    await expect(
      buildOAuthAccessTokenClaims(authorization, {
        user: { id: 'user-1' },
        scopes: new Set(['openid', 'contacts:read']),
        resource: 'https://api.example.com/contacts',
        referenceId: 'org-1',
        metadata: {
          applicationId: 'app-1',
          ignored: 'value',
        },
      }),
    ).resolves.toEqual({
      authorization: {
        roles: ['contacts-reader'],
      },
    })

    expect(authorization.buildTokenClaims).toHaveBeenCalledWith({
      userId: 'user-1',
      applicationId: 'app-1',
      organizationId: 'org-1',
      resource: 'https://api.example.com/contacts',
      scopes: ['openid', 'contacts:read'],
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

  it('configures built-in email, phone, One Tap, and SIWE provider plugins', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ messages: [{ status: '0' }] }))
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
      undefined,
      { builtInProviders: createBuiltInProviders() },
    )

    expect(findPlugin<EmailOtpPluginOptions>(auth, 'email-otp').options).toMatchObject({
      otpLength: 8,
      expiresIn: 900,
      changeEmail: {
        enabled: true,
        verifyCurrentEmail: false,
      },
    })
    expect(findPlugin<PhonePluginOptions>(auth, 'phone-number').options).toMatchObject({
      otpLength: 6,
      expiresIn: 300,
      requireVerification: true,
      signUpOnVerification: undefined,
    })
    expect(findPlugin<OneTapPluginOptions>(auth, 'one-tap').options).toMatchObject({
      clientId: 'google-client-id',
      disableSignup: false,
    })

    const siwe = findPlugin<SiwePluginOptions>(auth, 'siwe').options
    expect(siwe).toMatchObject({
      domain: 'wallet.example.com',
      emailDomainName: 'wallet.example.com',
      anonymous: true,
    })
    await expect(siwe.getNonce()).resolves.toMatch(/^[a-f0-9]{32}$/)

    const phone = findPlugin<PhonePluginOptions>(auth, 'phone-number').options
    await phone.sendOTP({ phoneNumber: '+15555550123', code: '123456' })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.twilio.com/2010-04-01/Accounts/twilio-sid/Messages.json',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('Basic '),
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      }),
    )
  })

  it('sends phone OTPs through each configured SMS provider and fails invalid provider config', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValue(jsonResponse({ messages: [{ status: '0' }] }))

    const vonage = findPlugin<PhonePluginOptions>(
      createAuth(
        {} as Database,
        '01234567890123456789012345678901',
        'https://auth.example.com',
        ['https://auth.example.com'],
        createEmailSenderMock(),
        createSecurityPolicy(),
        undefined,
        {
          builtInProviders: createBuiltInProviders({
            smsProvider: 'vonage',
            vonageApiKey: 'vonage-key',
            vonageApiSecret: 'vonage-secret',
            vonageFrom: 'FlareAuth',
          }),
        },
      ),
      'phone-number',
    ).options
    await vonage.sendPasswordResetOTP?.({ phoneNumber: '+15555550123', code: '123456' })
    expect(fetch).toHaveBeenCalledWith('https://rest.nexmo.com/sms/json', expect.objectContaining({ method: 'POST' }))

    const messageBird = findPlugin<PhonePluginOptions>(
      createAuth(
        {} as Database,
        '01234567890123456789012345678901',
        'https://auth.example.com',
        ['https://auth.example.com'],
        createEmailSenderMock(),
        createSecurityPolicy(),
        undefined,
        {
          builtInProviders: createBuiltInProviders({
            smsProvider: 'messagebird',
            messageBirdAccessKey: 'messagebird-key',
            messageBirdOriginator: 'FlareAuth',
          }),
        },
      ),
      'phone-number',
    ).options
    await messageBird.sendOTP({ phoneNumber: '+15555550123', code: '123456' })
    expect(fetch).toHaveBeenCalledWith(
      'https://rest.messagebird.com/messages',
      expect.objectContaining({ method: 'POST' }),
    )

    const brokenTwilio = findPlugin<PhonePluginOptions>(
      createAuth(
        {} as Database,
        '01234567890123456789012345678901',
        'https://auth.example.com',
        ['https://auth.example.com'],
        createEmailSenderMock(),
        createSecurityPolicy(),
        undefined,
        { builtInProviders: createBuiltInProviders({ twilioAuthToken: '' }) },
      ),
      'phone-number',
    ).options
    await expect(brokenTwilio.sendOTP({ phoneNumber: '+15555550123', code: '123456' })).rejects.toThrow(
      'Twilio SMS provider is not configured.',
    )

    const unsupported = findPlugin<PhonePluginOptions>(
      createAuth(
        {} as Database,
        '01234567890123456789012345678901',
        'https://auth.example.com',
        ['https://auth.example.com'],
        createEmailSenderMock(),
        createSecurityPolicy(),
        undefined,
        { builtInProviders: createBuiltInProviders({ smsProvider: 'unsupported' as 'twilio' }) },
      ),
      'phone-number',
    ).options
    await expect(unsupported.sendOTP({ phoneNumber: '+15555550123', code: '123456' })).rejects.toThrow(
      'Unsupported SMS provider: unsupported',
    )
  })

  it('disables direct passkey auth endpoints when passkeys are disabled by deployment policy', () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy({
        passkeys: {
          enabled: false,
          rpId: 'auth.example.com',
          rpName: 'FlareAuth',
          origins: ['https://auth.example.com'],
        },
      }),
    )

    expect(auth.options.disabledPaths).toEqual(
      expect.arrayContaining([
        '/passkey/generate-register-options',
        '/passkey/generate-authenticate-options',
        '/passkey/verify-registration',
        '/passkey/verify-authentication',
        '/passkey/list-user-passkeys',
        '/passkey/delete-passkey',
        '/passkey/update-passkey',
      ]),
    )
  })
})

function createEmailSenderMock() {
  return {
    send: vi.fn().mockResolvedValue({ messageId: 'email-1' }),
  }
}

function createUser() {
  return {
    id: 'user-1',
    name: 'User',
    email: 'user@example.com',
    emailVerified: false,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

type EmailOtpPluginOptions = {
  otpLength?: number
  expiresIn?: number
  changeEmail?: {
    enabled: boolean
    verifyCurrentEmail: boolean
  }
  sendVerificationOTP: (input: { email: string; otp: string; type: string }) => Promise<void>
}

type PhonePluginOptions = {
  otpLength?: number
  expiresIn?: number
  requireVerification?: boolean
  signUpOnVerification?: unknown
  sendOTP: (input: { phoneNumber: string; code: string }) => Promise<void>
  sendPasswordResetOTP?: (input: { phoneNumber: string; code: string }) => Promise<void>
}

type OneTapPluginOptions = {
  clientId?: string
  disableSignup?: boolean
}

type SiwePluginOptions = {
  domain: string
  emailDomainName?: string
  anonymous?: boolean
  getNonce: () => Promise<string>
}

type OrganizationPluginOptions = {
  sendInvitationEmail: (input: {
    email: string
    id: string
    inviter: { user: ReturnType<typeof createUser> }
  }) => Promise<void>
}

type UsernamePluginOptions = {
  minUsernameLength: number
  maxUsernameLength: number
  usernameValidator: (value: string) => boolean
}

type PasskeyPluginOptions = {
  rpID: string
  rpName: string
  origin: string[]
}

type TwoFactorPluginOptions = {
  issuer: string
  allowPasswordless: boolean
  otpOptions?: unknown
  totpOptions?: unknown
}

type OAuthProviderPluginOptions = {
  clientRegistrationAllowedScopes: readonly string[]
  customUserInfoClaims: (input: {
    user: unknown
    scopes: string[]
    jwt: Record<string, unknown>
  }) => Record<string, unknown>
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

function createBuiltInProviders(
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function findPlugin<TOptions extends object>(auth: ReturnType<typeof createAuth>, id: string) {
  const plugin = auth.options.plugins?.find((candidate) => candidate.id === id)

  if (!plugin) {
    throw new Error(`Plugin not found: ${id}`)
  }

  return plugin as unknown as { options: TOptions }
}
