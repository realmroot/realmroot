import { createTestDeps } from '@server/http/test-deps'
import {
  completeExternalOAuthIntent,
  createExternalAccount,
  createExternalAccountGrant,
  createExternalOAuthIntent,
  listExternalAccounts,
  requireControlledExternalAccount,
  resolveOAuthEndpoints,
  revokeExternalAccountGrant,
} from '@server/usecases/external-accounts'
import type {
  AgentIdentityAggregate,
  ConnectorRecord,
  ExternalAccountGrantRecord,
  ExternalAccountRecord,
  ExternalCredentialRecord,
  ExternalOAuthIntentRecord,
} from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'

describe('external account custody', () => {
  it('creates bearer and fixed-header accounts for each controlled owner', async () => {
    const deps = externalDeps()
    vi.mocked(deps.connectors.findById).mockResolvedValue(connector())
    vi.mocked(deps.externalAccounts.createAccountWithCredential).mockImplementation(async (account, credential) => ({
      account,
      credential,
    }))

    await expect(
      createExternalAccount(
        deps,
        {
          connectorId: 'connector-1',
          owner: { type: 'user' },
          displayName: 'Personal API',
          credential: { kind: 'bearer', token: 'token-1' },
        },
        'user-1',
      ),
    ).resolves.toMatchObject({ owner: { type: 'user', userId: 'user-1' }, credentialKind: 'bearer' })

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(agentIdentity())
    await expect(
      createExternalAccount(
        deps,
        {
          connectorId: 'connector-1',
          owner: { type: 'agent', agentIdentityId: 'identity-1' },
          displayName: 'Agent API',
          credential: { kind: 'header', value: 'header-secret' },
        },
        'user-1',
      ),
    ).resolves.toMatchObject({ owner: { type: 'agent', agentIdentityId: 'identity-1' }, credentialKind: 'header' })

    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue(member('owner'))
    await expect(
      createExternalAccount(
        deps,
        {
          connectorId: 'connector-1',
          owner: { type: 'organization', organizationId: 'org-1' },
          displayName: 'Organization API',
          credential: { kind: 'bearer', token: 'token-2' },
        },
        'user-1',
      ),
    ).resolves.toMatchObject({ owner: { type: 'organization', organizationId: 'org-1' } })
    expect(deps.secrets.seal).toHaveBeenCalledWith(
      expect.stringContaining('header-secret'),
      expect.stringMatching(/^external-account:extacct_.+:credential:extcred_/),
    )
  })

  it('rejects invalid connector, credential, header, and owner boundaries', async () => {
    const deps = externalDeps()
    const input = {
      connectorId: 'connector-1',
      owner: { type: 'user' as const },
      displayName: 'API',
      credential: { kind: 'bearer' as const, token: 'token' },
    }
    vi.mocked(deps.connectors.findById).mockResolvedValue(null)
    await expect(createExternalAccount(deps, input, 'user-1')).rejects.toMatchObject({ status: 404 })
    vi.mocked(deps.connectors.findById).mockResolvedValue(connector({ enabled: false }))
    await expect(createExternalAccount(deps, input, 'user-1')).rejects.toMatchObject({ status: 404 })
    vi.mocked(deps.connectors.findById).mockResolvedValue(connector({ apiBaseUrl: null }))
    await expect(createExternalAccount(deps, input, 'user-1')).rejects.toMatchObject({ status: 400 })
    vi.mocked(deps.connectors.findById).mockResolvedValue(connector({ credentialModes: ['header'] }))
    await expect(createExternalAccount(deps, input, 'user-1')).rejects.toMatchObject({ status: 400 })
    vi.mocked(deps.connectors.findById).mockResolvedValue(connector({ credentialHeaderName: null }))
    await expect(
      createExternalAccount(deps, { ...input, credential: { kind: 'header', value: 'secret' } }, 'user-1'),
    ).rejects.toMatchObject({ status: 400 })

    vi.mocked(deps.connectors.findById).mockResolvedValue(connector())
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(null)
    await expect(
      createExternalAccount(deps, { ...input, owner: { type: 'agent', agentIdentityId: 'missing' } }, 'user-1'),
    ).rejects.toMatchObject({ status: 404 })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(agentIdentity({ ownerUserId: 'other-user' }))
    await expect(
      createExternalAccount(deps, { ...input, owner: { type: 'agent', agentIdentityId: 'identity-1' } }, 'user-1'),
    ).rejects.toMatchObject({ status: 403 })
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue(member('member'))
    await expect(
      createExternalAccount(deps, { ...input, owner: { type: 'organization', organizationId: 'org-1' } }, 'user-1'),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('lists user and Agent-owned accounts without exposing credentials', async () => {
    const deps = externalDeps()
    vi.mocked(deps.agentIdentities.listPersonal).mockResolvedValue([agentIdentity()])
    vi.mocked(deps.externalAccounts.listByOwnerUser).mockResolvedValue([
      { account: account(), credential: credential() },
    ])
    vi.mocked(deps.externalAccounts.listByOwnerAgents).mockResolvedValue([
      {
        account: account({ id: 'account-2', ownerUserId: null, ownerAgentIdentityId: 'identity-1' }),
        credential: credential({ id: 'credential-2', externalAccountId: 'account-2', expiresAt: new Date() }),
      },
      {
        account: account({
          id: 'account-3',
          ownerUserId: null,
          ownerOrganizationId: 'org-1',
        }),
        credential: credential({ id: 'credential-3', externalAccountId: 'account-3' }),
      },
    ])

    await expect(listExternalAccounts(deps, 'user-1')).resolves.toMatchObject({
      externalAccounts: [
        { owner: { type: 'user' }, credentialConfigured: true },
        { owner: { type: 'agent' }, credentialExpiresAt: expect.any(String) },
        { owner: { type: 'organization' } },
      ],
    })
  })
})

describe('external OAuth connection', () => {
  it('creates a PKCE intent from OIDC discovery and explicit OAuth endpoints', async () => {
    const deps = externalDeps()
    vi.mocked(deps.connectors.findById).mockResolvedValue(connector())
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(
      Response.json({
        issuer: 'https://issuer.example.com/',
        authorization_endpoint: 'https://issuer.example.com/authorize',
        token_endpoint: 'https://issuer.example.com/token',
        userinfo_endpoint: 'https://issuer.example.com/userinfo',
      }),
    )

    const discovered = await createExternalOAuthIntent(
      deps,
      {
        connectorId: 'connector-1',
        owner: { type: 'user' },
        displayName: 'OAuth Account',
      },
      'user-1',
      'https://auth.example.com/',
    )
    expect(new URL(discovered.authorizationUrl)).toMatchObject({
      origin: 'https://issuer.example.com',
      pathname: '/authorize',
    })
    expect(new URL(discovered.authorizationUrl).searchParams.get('code_challenge_method')).toBe('S256')

    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connector({
        issuer: null,
        authorizationEndpoint: 'https://oauth.example.com/authorize',
        tokenEndpoint: 'https://oauth.example.com/token',
        userInfoEndpoint: null,
        scopes: null,
      }),
    )
    await expect(
      createExternalOAuthIntent(
        deps,
        {
          connectorId: 'connector-1',
          owner: { type: 'user' },
          displayName: 'OAuth Account',
          scopes: ['repo:read'],
        },
        'user-1',
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({ authorizationUrl: expect.stringContaining('scope=repo%3Aread') })

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(agentIdentity())
    await createExternalOAuthIntent(
      deps,
      {
        connectorId: 'connector-1',
        owner: { type: 'agent', agentIdentityId: 'identity-1' },
        displayName: 'Agent OAuth Account',
      },
      'user-1',
      'https://auth.example.com',
    )
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue(member('owner'))
    await createExternalOAuthIntent(
      deps,
      {
        connectorId: 'connector-1',
        owner: { type: 'organization', organizationId: 'org-1' },
        displayName: 'Organization OAuth Account',
      },
      'user-1',
      'https://auth.example.com',
    )
    expect(deps.externalAccounts.createOAuthIntent).toHaveBeenCalledTimes(4)
  })

  it('rejects incomplete OAuth connectors and invalid endpoint metadata', async () => {
    const deps = externalDeps()
    const input = {
      connectorId: 'connector-1',
      owner: { type: 'user' as const },
      displayName: 'OAuth Account',
    }
    vi.mocked(deps.connectors.findById).mockResolvedValue(null)
    await expect(createExternalOAuthIntent(deps, input, 'user-1', 'https://auth.example.com')).rejects.toMatchObject({
      status: 404,
    })
    vi.mocked(deps.connectors.findById).mockResolvedValue(connector({ providerType: 'generic_api' }))
    await expect(createExternalOAuthIntent(deps, input, 'user-1', 'https://auth.example.com')).rejects.toMatchObject({
      status: 400,
    })
    vi.mocked(deps.connectors.findById).mockResolvedValue(connector({ clientSecret: null }))
    await expect(createExternalOAuthIntent(deps, input, 'user-1', 'https://auth.example.com')).rejects.toMatchObject({
      status: 400,
    })

    vi.mocked(deps.connectors.findById).mockResolvedValue(connector())
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(new Response(null, { status: 502 }))
    await expect(createExternalOAuthIntent(deps, input, 'user-1', 'https://auth.example.com')).rejects.toMatchObject({
      status: 400,
    })
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(Response.json({ issuer: 'https://wrong.example.com' }))
    await expect(createExternalOAuthIntent(deps, input, 'user-1', 'https://auth.example.com')).rejects.toMatchObject({
      status: 400,
    })
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connector({ issuer: null, authorizationEndpoint: null, tokenEndpoint: null }),
    )
    await expect(resolveOAuthEndpoints(deps, await deps.connectors.findById('connector-1'))).rejects.toMatchObject({
      status: 400,
    })
    await expect(resolveOAuthEndpoints(deps, null)).rejects.toMatchObject({ status: 400 })
  })

  it('completes OAuth code exchange with refreshed custody metadata', async () => {
    const deps = externalDeps()
    vi.mocked(deps.externalAccounts.consumeOAuthIntent).mockResolvedValue(oauthIntent())
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connector({
        issuer: null,
        authorizationEndpoint: 'https://oauth.example.com/authorize',
        tokenEndpoint: 'https://oauth.example.com/token',
        userInfoEndpoint: 'https://oauth.example.com/userinfo',
      }),
    )
    vi.mocked(deps.secrets.open).mockResolvedValue('pkce-verifier')
    vi.mocked(deps.externalHttp.fetch)
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          token_type: 'DPoP',
          scope: 'repo:read',
          expires_in: 60,
        }),
      )
      .mockResolvedValueOnce(Response.json({ sub: 'external-user' }))
    vi.mocked(deps.externalAccounts.createAccountWithCredential).mockImplementation(
      async (createdAccount, createdCredential) => ({
        account: createdAccount,
        credential: createdCredential,
      }),
    )

    await expect(
      completeExternalOAuthIntent(deps, { state: 'state', code: 'authorization-code' }, 'https://auth.example.com/'),
    ).resolves.toMatchObject({
      externalSubject: 'external-user',
      credentialKind: 'oauth',
      credentialExpiresAt: expect.any(String),
    })

    const tokenRequest = vi.mocked(deps.externalHttp.fetch).mock.calls[0]![0]
    expect(tokenRequest.headers.get('authorization')).toMatch(/^Basic /)
    expect(await tokenRequest.text()).toContain('code_verifier=pkce-verifier')
  })

  it('supports minimal OAuth responses and rejects every exchange boundary', async () => {
    const deps = externalDeps()
    vi.mocked(deps.externalAccounts.consumeOAuthIntent).mockResolvedValue(
      oauthIntent({ agentIdentityId: 'identity-1', ownerOrganizationId: null }),
    )
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connector({
        issuer: null,
        authorizationEndpoint: 'https://oauth.example.com/authorize',
        tokenEndpoint: 'https://oauth.example.com/token',
        userInfoEndpoint: null,
      }),
    )
    vi.mocked(deps.secrets.open).mockResolvedValue('pkce-verifier')
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(Response.json({ access_token: 'access-token' }))
    vi.mocked(deps.externalAccounts.createAccountWithCredential).mockImplementation(
      async (createdAccount, createdCredential) => ({
        account: createdAccount,
        credential: createdCredential,
      }),
    )
    await expect(
      completeExternalOAuthIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).resolves.toMatchObject({ owner: { type: 'agent' }, externalSubject: null, credentialExpiresAt: null })

    vi.mocked(deps.externalAccounts.consumeOAuthIntent).mockResolvedValue(null)
    await expect(
      completeExternalOAuthIntent(deps, { state: 'bad', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toMatchObject({ status: 400 })
    vi.mocked(deps.externalAccounts.consumeOAuthIntent).mockResolvedValue(oauthIntent())
    vi.mocked(deps.connectors.findById).mockResolvedValue(null)
    await expect(
      completeExternalOAuthIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toMatchObject({ status: 400 })
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connector({
        issuer: null,
        authorizationEndpoint: 'https://oauth.example.com/authorize',
        tokenEndpoint: 'https://oauth.example.com/token',
      }),
    )
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(new Response(null, { status: 400 }))
    await expect(
      completeExternalOAuthIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toMatchObject({ status: 400 })
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(new Response('not-json'))
    await expect(
      completeExternalOAuthIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toMatchObject({ status: 400 })
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(Response.json({ access_token: '' }))
    await expect(
      completeExternalOAuthIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('validates discovery URLs and userinfo responses', async () => {
    const deps = externalDeps()
    const configured = connector()
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(
      Response.json({
        issuer: 'https://issuer.example.com',
        authorization_endpoint: 'https://issuer.example.com/authorize',
        token_endpoint: 'https://issuer.example.com/token',
      }),
    )
    await expect(resolveOAuthEndpoints(deps, configured)).resolves.toMatchObject({ userInfoEndpoint: null })

    for (const metadata of [
      {
        issuer: 'https://issuer.example.com',
        authorization_endpoint: 'http://issuer.example.com/authorize',
        token_endpoint: 'https://issuer.example.com/token',
      },
      {
        issuer: 'https://issuer.example.com',
        authorization_endpoint: 'https://user:pass@issuer.example.com/authorize',
        token_endpoint: 'https://issuer.example.com/token',
      },
    ]) {
      vi.mocked(deps.externalHttp.fetch).mockResolvedValue(Response.json(metadata))
      await expect(resolveOAuthEndpoints(deps, configured)).rejects.toMatchObject({ status: 400 })
    }

    vi.mocked(deps.externalAccounts.consumeOAuthIntent).mockResolvedValue(oauthIntent())
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connector({
        issuer: null,
        authorizationEndpoint: 'https://oauth.example.com/authorize',
        tokenEndpoint: 'https://oauth.example.com/token',
        userInfoEndpoint: 'https://oauth.example.com/userinfo',
      }),
    )
    vi.mocked(deps.secrets.open).mockResolvedValue('pkce')
    vi.mocked(deps.externalHttp.fetch)
      .mockResolvedValueOnce(Response.json({ access_token: 'access' }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
    await expect(
      completeExternalOAuthIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toMatchObject({ status: 400 })
    vi.mocked(deps.externalHttp.fetch)
      .mockResolvedValueOnce(Response.json({ access_token: 'access' }))
      .mockResolvedValueOnce(Response.json([]))
    await expect(
      completeExternalOAuthIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('external account grants', () => {
  it('creates a bounded, de-duplicated grant and revokes it', async () => {
    const deps = externalDeps()
    vi.mocked(deps.externalAccounts.findAccount).mockResolvedValue(account())
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(agentIdentity())
    vi.mocked(deps.connectors.findById).mockResolvedValue(connector())
    vi.mocked(deps.externalAccounts.createGrant).mockImplementation(async (record) => record)

    const grant = await createExternalAccountGrant(
      deps,
      'account-1',
      {
        agentIdentityId: 'identity-1',
        scopes: ['repo:read', 'repo:read'],
        allowedMethods: ['GET', 'GET'],
        allowedPathPrefixes: ['/v1/repos', '/v1/repos'],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      'user-1',
    )
    expect(grant).toMatchObject({
      scopes: ['repo:read'],
      allowedMethods: ['GET'],
      allowedPathPrefixes: ['/v1/repos'],
      expiresAt: expect.any(String),
      revokedAt: null,
    })

    vi.mocked(deps.externalAccounts.findGrant).mockResolvedValue(externalGrant())
    vi.mocked(deps.externalAccounts.revokeGrant).mockResolvedValue(true)
    await expect(revokeExternalAccountGrant(deps, 'account-1', 'grant-1', 'user-1')).resolves.toBeUndefined()

    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connector({ allowedMethods: null, allowedPathPrefixes: null }),
    )
    await expect(
      createExternalAccountGrant(
        deps,
        'account-1',
        {
          agentIdentityId: 'identity-1',
          scopes: [],
          allowedMethods: [],
          allowedPathPrefixes: [],
        },
        'user-1',
      ),
    ).resolves.toMatchObject({ expiresAt: null })
  })

  it('rejects grant and revocation boundary violations', async () => {
    const deps = externalDeps()
    vi.mocked(deps.externalAccounts.findAccount).mockResolvedValue(account())
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(agentIdentity())
    vi.mocked(deps.connectors.findById).mockResolvedValue(connector())
    const input = {
      agentIdentityId: 'identity-1',
      scopes: [],
      allowedMethods: ['GET' as const],
      allowedPathPrefixes: ['/v1/repos'],
    }

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(agentIdentity({ status: 'retired' }))
    await expect(createExternalAccountGrant(deps, 'account-1', input, 'user-1')).rejects.toMatchObject({ status: 400 })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(agentIdentity())
    vi.mocked(deps.connectors.findById).mockResolvedValue(connector({ apiBaseUrl: null }))
    await expect(createExternalAccountGrant(deps, 'account-1', input, 'user-1')).rejects.toMatchObject({ status: 400 })
    vi.mocked(deps.connectors.findById).mockResolvedValue(connector())
    await expect(
      createExternalAccountGrant(deps, 'account-1', { ...input, allowedMethods: ['POST'] }, 'user-1'),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      createExternalAccountGrant(deps, 'account-1', { ...input, allowedPathPrefixes: ['/admin'] }, 'user-1'),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      createExternalAccountGrant(
        deps,
        'account-1',
        { ...input, expiresAt: new Date(Date.now() - 1).toISOString() },
        'user-1',
      ),
    ).rejects.toMatchObject({ status: 400 })
    vi.mocked(deps.externalAccounts.findActiveGrant).mockResolvedValue(externalGrant())
    await expect(createExternalAccountGrant(deps, 'account-1', input, 'user-1')).rejects.toMatchObject({ status: 400 })

    vi.mocked(deps.externalAccounts.findGrant).mockResolvedValue(null)
    await expect(revokeExternalAccountGrant(deps, 'account-1', 'missing', 'user-1')).rejects.toMatchObject({
      status: 404,
    })
    vi.mocked(deps.externalAccounts.findGrant).mockResolvedValue(externalGrant({ externalAccountId: 'other' }))
    await expect(revokeExternalAccountGrant(deps, 'account-1', 'grant-1', 'user-1')).rejects.toMatchObject({
      status: 404,
    })
    vi.mocked(deps.externalAccounts.findGrant).mockResolvedValue(externalGrant())
    vi.mocked(deps.externalAccounts.revokeGrant).mockResolvedValue(false)
    await expect(revokeExternalAccountGrant(deps, 'account-1', 'grant-1', 'user-1')).rejects.toMatchObject({
      status: 400,
    })
  })

  it('controls user, Agent, and organization-owned accounts', async () => {
    const deps = externalDeps()
    vi.mocked(deps.externalAccounts.findAccount).mockResolvedValue(account())
    await expect(requireControlledExternalAccount(deps, 'account-1', 'user-1')).resolves.toMatchObject({
      id: 'account-1',
    })
    vi.mocked(deps.externalAccounts.findAccount).mockResolvedValue(
      account({ ownerUserId: null, ownerAgentIdentityId: 'identity-1' }),
    )
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(
      agentIdentity({ ownerUserId: null, ownerOrganizationId: 'org-1' }),
    )
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue(member('admin'))
    await expect(requireControlledExternalAccount(deps, 'account-1', 'user-1')).resolves.toMatchObject({
      id: 'account-1',
    })
    vi.mocked(deps.externalAccounts.findAccount).mockResolvedValue(
      account({ ownerUserId: null, ownerOrganizationId: 'org-1' }),
    )
    await expect(requireControlledExternalAccount(deps, 'account-1', 'user-1')).resolves.toMatchObject({
      id: 'account-1',
    })

    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue(null)
    await expect(requireControlledExternalAccount(deps, 'account-1', 'user-1')).rejects.toMatchObject({ status: 403 })
    vi.mocked(deps.externalAccounts.findAccount).mockResolvedValue(null)
    await expect(requireControlledExternalAccount(deps, 'missing', 'user-1')).rejects.toMatchObject({ status: 404 })
  })
})

function externalDeps() {
  return createTestDeps({
    authorization: {
      findMemberByOrganizationUser: vi.fn().mockResolvedValue(null),
    },
  })
}

function connector(overrides: Partial<ConnectorRecord> = {}): ConnectorRecord {
  const now = new Date()
  return {
    id: 'connector-1',
    slug: 'external',
    providerType: 'generic_oauth',
    providerId: 'generic',
    displayName: 'External',
    enabled: true,
    clientId: 'client-1',
    clientSecret: 'client-secret',
    issuer: 'https://issuer.example.com',
    authorizationEndpoint: null,
    tokenEndpoint: null,
    userInfoEndpoint: null,
    jwksEndpoint: null,
    scopes: ['openid'],
    apiBaseUrl: 'https://api.example.com',
    credentialModes: ['oauth', 'bearer', 'header'],
    credentialHeaderName: 'X-API-Key',
    allowedMethods: ['GET'],
    allowedPathPrefixes: ['/v1'],
    attributeMapping: null,
    providerMetadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function account(overrides: Partial<ExternalAccountRecord> = {}): ExternalAccountRecord {
  const now = new Date()
  return {
    id: 'account-1',
    connectorId: 'connector-1',
    ownerUserId: 'user-1',
    ownerOrganizationId: null,
    ownerAgentIdentityId: null,
    externalSubject: null,
    displayName: 'External',
    status: 'active',
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function credential(overrides: Partial<ExternalCredentialRecord> = {}): ExternalCredentialRecord {
  const now = new Date()
  return {
    id: 'credential-1',
    externalAccountId: 'account-1',
    kind: 'bearer',
    encryptedPayload: 'sealed',
    status: 'active',
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function agentIdentity(overrides: Partial<AgentIdentityAggregate['identity']> = {}): AgentIdentityAggregate {
  const now = new Date()
  return {
    identity: {
      id: 'identity-1',
      issuer: 'https://auth.example.com',
      subject: 'agt_stable',
      name: 'Agent',
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
      status: 'active',
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    },
    bindings: [],
  }
}

function oauthIntent(overrides: Partial<ExternalOAuthIntentRecord> = {}): ExternalOAuthIntentRecord {
  const now = new Date()
  return {
    id: 'intent-1',
    stateHash: 'hash',
    connectorId: 'connector-1',
    ownerUserId: 'user-1',
    agentIdentityId: null,
    ownerOrganizationId: null,
    displayName: 'OAuth Account',
    scopes: ['openid'],
    encryptedPkceVerifier: 'sealed',
    status: 'pending',
    expiresAt: new Date(now.getTime() + 60_000),
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function externalGrant(overrides: Partial<ExternalAccountGrantRecord> = {}): ExternalAccountGrantRecord {
  const now = new Date()
  return {
    id: 'grant-1',
    externalAccountId: 'account-1',
    agentIdentityId: 'identity-1',
    scopes: ['repo:read'],
    allowedMethods: ['GET'],
    allowedPathPrefixes: ['/v1/repos'],
    status: 'active',
    grantedByUserId: 'user-1',
    expiresAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function member(role: 'owner' | 'admin' | 'member') {
  return {
    id: 'member-1',
    organizationId: 'org-1',
    userId: 'user-1',
    role,
    title: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}
