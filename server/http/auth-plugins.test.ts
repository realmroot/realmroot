import * as applicationRepositories from '@server/adapters/repos/applications'
import * as authorizationRepositories from '@server/adapters/repos/authorization'
import { buildOAuthAccessTokenClaims, createAuth } from '@server/auth'
import type { OAuthProviderPluginOptions } from '@server/auth-test-plugin-types'
import type { Database } from '@server/db/client'
import { createApp } from '@server/http/app'
import * as authorizationUsecase from '@server/usecases/authorization'
import type { Deps } from '@server/usecases/deps'
import { createIdentifierGeneratorFake } from '@server/usecases/identifier-generator.fake'
import type { ManagementSignInSettingsResponse } from '@shared/api/management'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from './test-deps'

describe('auth.test 2', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('publishes Agent identity enrollment without legacy capability execution [spec: admin-console/agent-discovery]', async () => {
    const auth = createAuth(
      {} as Database,
      createIdentifierGeneratorFake(),
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
    )
    const app = createApp(auth, createTestDeps())

    const discovery = await app.request('https://auth.example.com/.well-known/agent-configuration')
    expect(discovery.status).toBe(200)
    const metadata = await discovery.json()
    expect(metadata).toMatchObject({
      issuer: 'https://auth.example.com/api/auth',
      agent_identity_issuer: 'https://auth.example.com/api/auth',
      agent_endpoint: 'https://auth.example.com/api/agent',
      agent_enrollment_endpoint: 'https://auth.example.com/api/agent/enrollments',
      agent_profile_uri_template: 'https://auth.example.com/api/public/agents/{subject}',
      agent_token_endpoint: 'https://auth.example.com/api/auth/oauth2/token',
      agent_bootstrap_scopes_supported: [
        'agent:read',
        'resource-servers:read',
        'authorization-details:read',
        'access-requests:read',
        'access-requests:write',
      ],
      agent_jwks_uri: 'https://auth.example.com/api/auth/jwks',
      modes: ['delegated'],
      approval_methods: ['device_authorization'],
      endpoints: {
        register: 'https://auth.example.com/api/auth/agent/register',
      },
    })
    const capabilitiesResponse = await app.request('https://auth.example.com/api/auth/capability/list')
    expect(capabilitiesResponse.status).toBe(404)
  })

  it('configures organization access control with explicit Teams and no default Team', () => {
    const auth = createAuth(
      {} as Database,
      createIdentifierGeneratorFake(),
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
    )

    const organizationPlugin = auth.options.plugins?.find((plugin) => plugin.id === 'organization')

    expect(organizationPlugin?.options).toMatchObject({
      teams: {
        enabled: true,
        defaultTeam: { enabled: false },
      },
    })
  })

  it('keeps Realmroot resource capabilities out of OAuth client scopes and userinfo', async () => {
    const auth = createAuth(
      {} as Database,
      createIdentifierGeneratorFake(),
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
    )
    const oauth = findPlugin<OAuthProviderPluginOptions>(auth, 'oauth-provider').options
    expect(oauth.clientRegistrationAllowedScopes).toEqual(['openid', 'profile', 'email', 'groups', 'offline_access'])
    expect(oauth.customUserInfoClaims).toBeUndefined()
  })

  it('[spec: hosted-auth/oauth-authorization-context-selection] redirects post-login to Context selection and revalidates membership', async () => {
    const findOrganization = vi.fn().mockResolvedValue({ id: 'org-1', disabled: false })
    const findMemberByOrganizationUser = vi.fn().mockResolvedValue({ id: 'member-1' })
    vi.spyOn(authorizationRepositories, 'createDrizzleAuthorizationRepository').mockReturnValue({
      findOrganization,
      findMemberByOrganizationUser,
    } as never)
    vi.spyOn(applicationRepositories, 'createDrizzleApplicationRepository').mockReturnValue({
      findByClientId: vi.fn().mockResolvedValue({ visibility: 'public' }),
    } as never)
    const auth = createAuth(
      {} as Database,
      createIdentifierGeneratorFake(),
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
    )
    const postLogin = findPlugin<OAuthProviderPluginOptions>(auth, 'oauth-provider').options.postLogin

    expect(postLogin.page).toBe('/auth/context')
    await expect(postLogin.shouldRedirect({ headers: new Headers(), user: { id: 'user-1' } })).resolves.toBe(false)
    await expect(
      postLogin.shouldRedirect({
        headers: new Headers({
          'x-realmroot-oauth-client-id': 'client-1',
          'x-realmroot-oauth-resources': JSON.stringify(['https://api.example.com/']),
        }),
        user: { id: 'user-1' },
      }),
    ).resolves.toBe(true)
    await expect(
      postLogin.consentReferenceId({
        session: { activeOrganizationId: 'org-1' },
        user: { id: 'user-1' },
      }),
    ).resolves.toBeUndefined()
    await expect(
      postLogin.consentReferenceId({
        session: { activeOrganizationId: null },
        user: { id: 'user-1' },
        referenceId: 'user:user-1',
      }),
    ).resolves.toBe('user:user-1')
    await expect(
      postLogin.consentReferenceId({
        session: { activeOrganizationId: null },
        user: { id: 'user-1' },
        referenceId: 'organization:org-1',
      }),
    ).resolves.toBe('organization:org-1')
    expect(findMemberByOrganizationUser).toHaveBeenCalledWith('org-1', 'user-1')

    findMemberByOrganizationUser.mockResolvedValueOnce(null)
    await expect(
      postLogin.consentReferenceId({
        session: { activeOrganizationId: null },
        user: { id: 'user-1' },
        referenceId: 'organization:org-1',
      }),
    ).rejects.toMatchObject({
      status: 'FORBIDDEN',
      body: { error: 'access_denied' },
    })
    findOrganization.mockResolvedValueOnce({ id: 'org-1', disabled: true })
    await expect(
      postLogin.consentReferenceId({
        session: { activeOrganizationId: null },
        user: { id: 'user-1' },
        referenceId: 'organization:org-1',
      }),
    ).rejects.toMatchObject({
      status: 'FORBIDDEN',
      body: { error: 'access_denied' },
    })
  })

  it('maps OAuth provider context into authorization token claims', async () => {
    const deps = {
      applications: {
        findById: vi.fn().mockResolvedValue({ visibility: 'public' }),
      },
      authorization: {
        findOrganization: vi.fn().mockResolvedValue({ id: 'org-1', disabled: false }),
        findMemberByOrganizationUser: vi.fn().mockResolvedValue({ id: 'member-1' }),
      },
    } as unknown as Deps
    const buildTokenClaims = vi.spyOn(authorizationUsecase, 'buildTokenClaims').mockResolvedValue({
      authorization: { roles: ['contacts-reader'] },
      roles: ['contacts-reader'],
      groups: ['org-1'],
    })

    await expect(
      buildOAuthAccessTokenClaims(deps, {
        user: { id: 'user-1' },
        scopes: new Set(['openid', 'contacts:read']),
        resource: 'https://api.example.com/contacts',
        referenceId: 'organization:org-1',
        metadata: {
          applicationId: 'app-1',
          ignored: 'value',
        },
      }),
    ).resolves.toEqual({
      roles: ['contacts-reader'],
      groups: ['org-1'],
      'urn:realmroot:params:oauth:org': 'org-1',
    })

    expect(buildTokenClaims).toHaveBeenCalledWith(deps, {
      userId: 'user-1',
      applicationId: 'app-1',
      organizationId: 'org-1',
      resource: 'https://api.example.com/contacts',
      scopes: ['openid', 'contacts:read'],
      authorizedScopes: ['contacts:read'],
    })
  })

  it('rejects a stale public Application Organization Context after membership removal', async () => {
    const deps = {
      applications: {
        findById: vi.fn().mockResolvedValue({ visibility: 'public' }),
      },
      authorization: {
        findOrganization: vi.fn().mockResolvedValue({ id: 'org-1', disabled: false }),
        findMemberByOrganizationUser: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Deps
    const buildTokenClaims = vi.spyOn(authorizationUsecase, 'buildTokenClaims')

    await expect(
      buildOAuthAccessTokenClaims(deps, {
        user: { id: 'user-1' },
        scopes: new Set(['openid']),
        referenceId: 'organization:org-1',
        metadata: { applicationId: 'app-1' },
      }),
    ).rejects.toMatchObject({ body: { error: 'access_denied' } })
    expect(buildTokenClaims).not.toHaveBeenCalled()
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
      rpName: 'Realmroot',
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
      projectId: null,
      secretKey: '',
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
    projectId: string | null
    secretKey: string
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
