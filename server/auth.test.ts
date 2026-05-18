import { describe, expect, it, vi } from 'vitest'
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
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
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
    await findPlugin<MagicLinkPluginOptions>(auth, 'magic-link').options.sendMagicLink({
      email: 'user@example.com',
      url: 'https://auth.example.com/magic',
      token: 'magic-token',
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
        type: 'magic-link',
        url: 'https://auth.example.com/magic',
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

  it('exposes security, magic link, email OTP, username, and organization invitation APIs', () => {
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
        'signInMagicLink',
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
    })
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

type MagicLinkPluginOptions = {
  sendMagicLink: (input: { email: string; url: string; token: string }) => Promise<void>
}

type EmailOtpPluginOptions = {
  sendVerificationOTP: (input: { email: string; otp: string; type: string }) => Promise<void>
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
}

function createSecurityPolicy(overrides: Partial<SecurityPolicyInput> = {}) {
  return {
    mfa: {
      mode: 'optional',
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
  } satisfies SecurityPolicyInput
}

interface SecurityPolicyInput {
  mfa: {
    mode: 'optional' | 'required'
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
}

function findPlugin<TOptions extends object>(auth: ReturnType<typeof createAuth>, id: string) {
  const plugin = auth.options.plugins?.find((candidate) => candidate.id === id)

  if (!plugin) {
    throw new Error(`Plugin not found: ${id}`)
  }

  return plugin as unknown as { options: TOptions }
}
