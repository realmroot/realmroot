import { buildOAuthAccessTokenClaims, buildOAuthIdTokenClaims, createAuth } from '@server/auth'
import type { OAuthProviderPluginOptions } from '@server/auth-test-plugin-types'
import type { Database } from '@server/db/client'
import { createApp } from '@server/http/app'
import * as authorizationUsecase from '@server/usecases/authorization'
import type { Deps } from '@server/usecases/deps'
import type { ManagementSignInSettingsResponse } from '@shared/api/management'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from './test-deps'

describe('auth.test 2', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves mounted AgentAuth discovery and capability catalog without Management API generation [spec: admin-console/agent-discovery]', async () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
    )
    const app = createApp(auth, createTestDeps())

    const discovery = await app.request('https://auth.example.com/.well-known/agent-configuration')
    expect(discovery.status).toBe(200)
    await expect(discovery.json()).resolves.toMatchObject({
      issuer: 'https://auth.example.com/api/auth',
      default_location: 'https://auth.example.com/api/auth/capability/execute',
      modes: ['delegated'],
      approval_methods: ['device_authorization'],
      endpoints: {
        register: 'https://auth.example.com/api/auth/agent/register',
        execute: 'https://auth.example.com/api/auth/capability/execute',
      },
    })

    const capabilitiesResponse = await app.request('https://auth.example.com/api/auth/capability/list')
    expect(capabilitiesResponse.status).toBe(200)
    const capabilities = (await capabilitiesResponse.json()) as { capabilities: Array<{ name: string }> }
    expect(capabilities.capabilities.map((capability) => capability.name)).toEqual([
      'account.profile.read',
      'account.sessions.list',
      'account.authorized_apps.list',
    ])
    expect(capabilities.capabilities.map((capability) => capability.name).join(' ')).not.toContain('management')
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

  it('limits management userinfo claims to the system CLI client', async () => {
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
    await expect(
      oauth.customUserInfoClaims({
        user,
        scopes: ['openid', 'management:read'],
        jwt,
      }),
    ).resolves.toEqual({})
    await expect(
      oauth.customUserInfoClaims({
        user,
        scopes: ['openid', 'management:read'],
        jwt: { ...jwt, azp: 'flareauth-cli' },
      }),
    ).resolves.toEqual({
      role: 'admin',
      scope: 'openid management:read',
      client_id: 'flareauth-cli',
      authorization: { roles: ['admin'] },
      roles: ['admin'],
    })
  })

  it('maps OAuth provider context into authorization token claims', async () => {
    const deps = {} as Deps
    const buildTokenClaims = vi.spyOn(authorizationUsecase, 'buildTokenClaims').mockResolvedValue({
      authorization: {
        roles: ['contacts-reader'],
      },
    })

    await expect(
      buildOAuthAccessTokenClaims(deps, {
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

    expect(buildTokenClaims).toHaveBeenCalledWith(deps, {
      userId: 'user-1',
      applicationId: 'app-1',
      organizationId: 'org-1',
      resource: 'https://api.example.com/contacts',
      scopes: ['openid', 'contacts:read'],
      destination: 'access_token',
      claimSelection: {
        authorization: true,
        roles: true,
        permissions: true,
      },
    })
  })

  it('maps configured OAuth provider context into ID token claims', async () => {
    const deps = {} as Deps
    const buildTokenClaims = vi.spyOn(authorizationUsecase, 'buildTokenClaims').mockResolvedValue({
      roles: ['admin'],
    })

    await expect(
      buildOAuthIdTokenClaims(deps, {
        user: { id: 'user-1' },
        scopes: ['openid', 'contacts:read'],
        metadata: {
          applicationId: 'app-1',
          oidcClaims: {
            accessToken: {},
            idToken: { roles: true },
            userInfo: {},
          },
        },
      }),
    ).resolves.toEqual({
      application_id: 'app-1',
      roles: ['admin'],
    })

    expect(buildTokenClaims).toHaveBeenCalledWith(deps, {
      userId: 'user-1',
      applicationId: 'app-1',
      scopes: ['openid', 'contacts:read'],
      destination: 'id_token',
      claimSelection: { roles: true },
    })
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
