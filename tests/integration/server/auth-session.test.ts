import { createApp } from '@server/app'
import { createAuth } from '@server/auth'
import type {
  AgentAuthPluginOptions,
  EmailOtpPluginOptions,
  OrganizationPluginOptions,
} from '@server/auth-test-plugin-types'
import type { Database } from '@server/db/client'
import type { ManagementSignInSettingsResponse } from '@shared/api/management'
import { describe, expect, it, vi } from 'vitest'

describe('auth.test 1', () => {
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
      grant_types_supported: string[]
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
    expect(metadata).not.toHaveProperty('device_authorization_endpoint')
    expect(metadata.grant_types_supported).not.toContain('urn:ietf:params:oauth:grant-type:device_code')
  })

  it('does not accept device-code grants at the OAuth Provider token endpoint', async () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
    )

    const response = await createApp(auth).request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: 'native-client',
        device_code: 'device-code-1',
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining(
        '[body.grant_type] Invalid option: expected one of "authorization_code"|"client_credentials"|"refresh_token"',
      ),
    })
  })

  it('passes mounted authorize query parameters to Better Auth', async () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
    )

    const query = new URLSearchParams({
      client_id: 'client-1',
      redirect_uri: 'https://app.example.com/callback',
      response_type: 'code',
      scope: 'openid profile email',
      state: 'state-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
    })
    const response = await createApp(auth).request(`/api/auth/oauth2/authorize?${query}`)

    expect(response.headers.get('location') ?? (await response.text())).not.toContain('client_id is required')
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
        'getAgentConfiguration',
        'register',
        'requestCapability',
        'approveCapability',
        'executeCapability',
      ]),
    )
    expect(Object.keys(auth.api)).not.toEqual(
      expect.arrayContaining(['createTeam', 'listOrganizationTeams', 'setActiveTeam', 'addTeamMember']),
    )
  })

  it('configures AgentAuth as delegated-only with read-only account capabilities', async () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com/api/auth',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
    )
    const agentAuthPlugin = findPlugin<AgentAuthPluginOptions>(auth, 'agent-auth')

    expect(agentAuthPlugin.options).toMatchObject({
      providerName: 'FlareAuth',
      modes: ['delegated'],
      approvalMethods: ['device_authorization'],
      deviceAuthorizationPage: '/agent/approve',
      allowDynamicHostRegistration: true,
      defaultHostCapabilities: [],
      requireAuthForCapabilities: false,
    })
    expect(agentAuthPlugin.options.capabilities.map((capability) => capability.name)).toEqual([
      'account.profile.read',
      'account.sessions.list',
      'account.authorized_apps.list',
    ])
    expect(agentAuthPlugin.options.validateCapabilities(['account.profile.read'])).toBe(true)
    expect(agentAuthPlugin.options.validateCapabilities(['management.users.delete'])).toBe(false)
    expect(agentAuthPlugin.options.resolveAutonomousUser).toBeUndefined()
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

function findPlugin<TOptions extends object>(auth: ReturnType<typeof createAuth>, id: string) {
  const plugin = auth.options.plugins?.find((candidate) => candidate.id === id)

  if (!plugin) {
    throw new Error(`Plugin not found: ${id}`)
  }

  return plugin as unknown as { options: TOptions }
}
