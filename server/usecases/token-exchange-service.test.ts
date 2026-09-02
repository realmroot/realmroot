import { createJwksGateway } from '@server/adapters/gateways/jwks'
import { hashProviderSecret } from '@server/usecases/applications-utils'
import type { Deps } from '@server/usecases/deps'
import { createIdentifierGeneratorFake } from '@server/usecases/identifier-generator.fake'
import type {
  CreateFederatedCredentialInput,
  FederatedCredentialRecord,
  OAuthClientRecord,
  ResolvedFederatedCredential,
  TokenExchangeAccessTokenRecord,
  TokenExchangeRefreshTokenRecord,
  TokenExchangeRepository,
  UpdateFederatedCredentialInput,
} from '@server/usecases/ports'
import {
  accessTokenType,
  createFederatedCredential,
  deleteFederatedCredential,
  exchangeToken as exchangeTokenVerified,
  getFederatedCredential,
  idTokenType,
  introspectToken as introspectTokenVerified,
  isTokenExchangeAccessToken,
  jwtTokenType,
  listFederatedCredentials,
  parseBasicClientAuthorization,
  refreshTokenGrantType,
  refreshToken as refreshTokenVerified,
  tokenExchangeGrantType,
  unverifiedSubjectTokenAudience,
  updateFederatedCredential,
} from '@server/usecases/token-exchange'
import { realmrootOrganizationClaim } from '@shared/oauth-token-profile'
import { afterEach, describe, expect, it, vi } from 'vitest'

const applicationId = 'app_1'
const applicationClientId = 'runner-client'
const audienceResourceId = 'res_1'
const defaultAudience = 'https://ama.example.com'
const realmrootIssuer = 'https://auth.example.com/api/auth'
const tokenSigner = {
  issuer: realmrootIssuer,
  sign: async (payload: Record<string, unknown>) => testAccessToken(payload),
}
const tokenVerifier = { verify: async (token: string) => decodeTestAccessToken(token) }

function exchangeToken(
  deps: Deps,
  input: Parameters<typeof exchangeTokenVerified>[1],
  client: Parameters<typeof exchangeTokenVerified>[2],
) {
  return exchangeTokenVerified(deps, input, client, tokenSigner)
}

function refreshToken(
  deps: Deps,
  input: Parameters<typeof refreshTokenVerified>[1],
  client: Parameters<typeof refreshTokenVerified>[2],
) {
  return refreshTokenVerified(deps, input, client, tokenSigner)
}

function introspectToken(
  deps: Deps,
  token: string,
  client: Parameters<typeof introspectTokenVerified>[2],
  issuer: string,
) {
  return introspectTokenVerified(deps, token, client, issuer, tokenVerifier)
}

function testAccessToken(payload: Record<string, unknown>) {
  return `${btoa(JSON.stringify({ alg: 'RS256', typ: 'at+jwt' }))}.${btoa(JSON.stringify(payload))}.signature`
}

function decodeTestAccessToken(token: string) {
  const payload = token.split('.')[1]
  if (!payload) throw new Error('Malformed test access token.')
  return JSON.parse(atob(payload)) as Record<string, unknown>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('token exchange service', () => {
  it('delegates a Realmroot User access token only from a configured source to an entitled target [spec: agent-identity/user-resource-token-delegation]', async () => {
    const { deps, clientSecret } = await tokenExchangeFixture({ scopes: ['agents:write'] })
    const sourceResource = eligibleAudienceResource(['ama:agents:create', 'ama:agents:read'])
    const targetResource = {
      ...eligibleAudienceResource(['agents:read', 'agents:write']),
      id: 'res_realmroot',
      resourceUrl: 'https://auth.example.com/api',
      visibility: 'public' as const,
      scopeRegistry: {
        ...eligibleAudienceResource(['agents:read', 'agents:write']).scopeRegistry,
        scopes: ['agents:read', 'agents:write'].map((value) => ({
          value,
          description: null,
          grantMode: 'assigned' as const,
        })),
      },
    }
    const findApplication = deps.applications.findByClientId
    deps.applications.findByClientId = async (clientId) => {
      const application = await findApplication(clientId)
      return application
        ? {
            ...application,
            tokenExchangePolicies: [
              {
                sourceResourceServerId: sourceResource.id,
                targetResourceServerId: targetResource.id,
                scopeMappings: [
                  { sourceScope: 'ama:agents:create', targetScope: 'agents:write' },
                  { sourceScope: 'ama:agents:read', targetScope: 'agents:read' },
                ],
              },
            ],
            resourceScopes: [{ resourceServerId: targetResource.id, scopes: ['agents:read', 'agents:write'] }],
          }
        : null
    }
    deps.authorization.findResourceByResourceUrl = async (resourceUrl) =>
      (resourceUrl === sourceResource.resourceUrl
        ? sourceResource
        : resourceUrl === targetResource.resourceUrl
          ? targetResource
          : null) as never
    deps.authorization.listActiveApplicationScopeEntitlements = async () =>
      [{ scope: 'agents:read' }, { scope: 'agents:write' }] as never
    deps.authorization.listActiveUserScopeEntitlements = async () =>
      [
        { scope: 'agents:read', organizationId: null },
        { scope: 'agents:write', organizationId: null },
      ] as never

    const input = {
      grantType: tokenExchangeGrantType,
      subjectToken: 'verified-by-http-adapter',
      subjectTokenType: accessTokenType,
      audience: targetResource.resourceUrl,
      scope: 'agents:read agents:write',
      verifiedSubjectClaims: {
        iss: realmrootIssuer,
        sub: 'user_1',
        aud: sourceResource.resourceUrl,
        client_id: 'browser-client',
        scope: 'ama:agents:create',
        exp: Math.floor(Date.now() / 1000) + 600,
      },
    }
    const response = await exchangeToken(deps, input, { clientId: applicationClientId, clientSecret })

    expect(response).not.toHaveProperty('refresh_token')
    expect(decodeTestAccessToken(response.access_token)).toMatchObject({
      sub: 'user_1',
      aud: targetResource.resourceUrl,
      client_id: applicationClientId,
      scope: 'agents:write',
    })
    expect(decodeTestAccessToken(response.access_token)).not.toHaveProperty('act')

    const sourceWithoutMappedScope = {
      ...sourceResource,
      scopeRegistry: {
        ...sourceResource.scopeRegistry!,
        scopes: sourceResource.scopeRegistry!.scopes.filter((scope) => scope.value !== 'ama:agents:create'),
      },
    }
    deps.authorization.findResourceByResourceUrl = async (resourceUrl) =>
      (resourceUrl === sourceResource.resourceUrl
        ? sourceWithoutMappedScope
        : resourceUrl === targetResource.resourceUrl
          ? targetResource
          : null) as never
    await expect(exchangeToken(deps, input, { clientId: applicationClientId, clientSecret })).rejects.toMatchObject({
      error: 'invalid_scope',
    })

    deps.authorization.findResourceByResourceUrl = async (resourceUrl) =>
      (resourceUrl === sourceResource.resourceUrl
        ? sourceResource
        : resourceUrl === targetResource.resourceUrl
          ? targetResource
          : null) as never
    deps.authorization.listActiveUserScopeEntitlements = async () =>
      [{ scope: 'agents:write', organizationId: 'org-other' }] as never
    await expect(exchangeToken(deps, input, { clientId: applicationClientId, clientSecret })).rejects.toMatchObject({
      error: 'invalid_scope',
    })
  })

  it('[spec: agent-identity/agent-resource-token-delegation] preserves an active Agent actor across Resource delegation', async () => {
    const { deps, clientSecret } = await tokenExchangeFixture({ scopes: ['identities:write'] })
    const sourceResource = eligibleAudienceResource(['ak:agent:create'])
    const targetResource = {
      ...eligibleAudienceResource(['identities:write']),
      id: 'res_ama',
      resourceUrl: 'https://ama.example.com/api',
      authorizationModel: 'native' as const,
      scopeRegistry: {
        ...eligibleAudienceResource(['identities:write']).scopeRegistry,
        scopes: [{ value: 'identities:write', description: null, grantMode: 'assigned' as const }],
      },
    }
    const findApplication = deps.applications.findByClientId
    deps.applications.findByClientId = async (clientId) => {
      const application = await findApplication(clientId)
      return application
        ? {
            ...application,
            tokenExchangePolicies: [
              {
                sourceResourceServerId: sourceResource.id,
                targetResourceServerId: targetResource.id,
                scopeMappings: [{ sourceScope: 'ak:agent:create', targetScope: 'identities:write' }],
              },
            ],
            resourceScopes: [{ resourceServerId: targetResource.id, scopes: ['identities:write'] }],
          }
        : null
    }
    deps.authorization.findResourceByResourceUrl = async (resourceUrl) =>
      (resourceUrl === sourceResource.resourceUrl
        ? sourceResource
        : resourceUrl === targetResource.resourceUrl
          ? targetResource
          : null) as never
    deps.authorization.listActiveApplicationScopeEntitlements = async () => [{ scope: 'identities:write' }] as never
    deps.authorization.listActiveUserScopeEntitlements = async () =>
      [{ scope: 'identities:write', organizationId: 'org_1' }] as never
    deps.authorization.findOrganization = async () => ({ id: 'org_1', disabled: false }) as never
    deps.authorization.findMemberByOrganizationUser = async () => ({ id: 'member_1' }) as never
    const identity = {
      id: 'agent_identity_1',
      issuer: realmrootIssuer,
      subject: 'agent_1',
      ownerUserId: 'user_1',
      ownerOrganizationId: null,
      status: 'active',
      deletedAt: null,
    }
    deps.agentIdentities = {
      findByIssuerSubject: vi.fn().mockResolvedValue(identity),
      findIdentity: vi.fn().mockResolvedValue({
        identity,
        bindings: [{ id: 'binding_1', status: 'active', revokedAt: null }],
      }),
    } as never
    deps.externalResources = {
      findActiveTokenLeaseByTokenHash: vi
        .fn()
        .mockResolvedValue({ id: 'lease_1', requestId: 'request_1', bindingId: 'binding_1' }),
      findAccessRequest: vi.fn().mockResolvedValue({
        id: 'request_1',
        resourceId: sourceResource.id,
        agentIdentityId: identity.id,
      }),
    } as never
    deps.agentAudit = { append: vi.fn() } as never
    const input = {
      grantType: tokenExchangeGrantType,
      subjectToken: 'active-agent-resource-token',
      subjectTokenType: accessTokenType,
      audience: targetResource.resourceUrl,
      scope: 'identities:write',
      verifiedSubjectClaims: {
        iss: realmrootIssuer,
        sub: 'user_1',
        aud: sourceResource.resourceUrl,
        jti: 'resat_1',
        client_id: 'realmroot-cli',
        scope: 'ak:agent:create',
        exp: Math.floor(Date.now() / 1000) + 600,
        [realmrootOrganizationClaim]: 'org_1',
        act: { iss: realmrootIssuer, sub: 'agent_1' },
      },
    }

    const response = await exchangeToken(deps, input, { clientId: applicationClientId, clientSecret })

    expect(response).not.toHaveProperty('refresh_token')
    expect(decodeTestAccessToken(response.access_token)).toMatchObject({
      sub: 'user_1',
      act: { iss: realmrootIssuer, sub: 'agent_1' },
      aud: targetResource.resourceUrl,
      client_id: applicationClientId,
      scope: 'identities:write',
      [realmrootOrganizationClaim]: 'org_1',
    })
    expect(deps.agentAudit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'oauth.agent_resource_token_exchanged',
        result: 'allowed',
        ownerOrganizationId: 'org_1',
        controllerUserId: 'user_1',
        subject: 'agent_1',
        resourceId: targetResource.id,
        scopes: ['identities:write'],
      }),
    )

    vi.mocked(deps.externalResources.findActiveTokenLeaseByTokenHash).mockResolvedValueOnce(null)
    await expect(exchangeToken(deps, input, { clientId: applicationClientId, clientSecret })).rejects.toMatchObject({
      error: 'invalid_grant',
    })
    expect(deps.agentAudit.append).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'oauth.agent_resource_token_exchanged',
        result: 'denied',
        reasonCode: 'invalid_grant',
      }),
    )
  })

  it('[spec: agent-identity/agent-resource-token-delegation] delegates a personal-context Agent token without Organization lookup', async () => {
    const fixture = await agentResourceDelegationFixture()
    delete fixture.input.verifiedSubjectClaims[realmrootOrganizationClaim]
    fixture.targetResource.scopeRegistry.scopes.push({
      value: 'identities:delete',
      description: null,
      grantMode: 'assigned',
    })
    fixture.setPolicies([
      {
        sourceResourceServerId: fixture.sourceResource.id,
        targetResourceServerId: fixture.targetResource.id,
        scopeMappings: [
          { sourceScope: 'ak:agent:create', targetScope: 'identities:write' },
          { sourceScope: 'ak:agent:create', targetScope: 'identities:delete' },
        ],
      },
    ])
    const findApplication = fixture.deps.applications.findByClientId
    fixture.deps.applications.findByClientId = async (clientId) => {
      const application = await findApplication(clientId)
      return application
        ? {
            ...application,
            resourceScopes: [
              { resourceServerId: fixture.targetResource.id, scopes: ['identities:write', 'identities:delete'] },
            ],
          }
        : null
    }
    fixture.deps.authorization.listActiveApplicationScopeEntitlements = async () =>
      [{ scope: 'identities:write' }, { scope: 'identities:delete' }] as never
    fixture.deps.authorization.listActiveUserScopeEntitlements = async () =>
      [{ scope: 'identities:write', organizationId: null }] as never
    const findOrganization = vi.fn().mockResolvedValue({ id: 'org_1', disabled: false })
    const findMemberByOrganizationUser = vi.fn(() => {
      throw new Error('Personal Context must not query Organization membership')
    })
    fixture.deps.authorization.findOrganization = findOrganization as never
    fixture.deps.authorization.findMemberByOrganizationUser = findMemberByOrganizationUser as never

    const response = await exchangeToken(
      fixture.deps,
      { ...fixture.input, scope: 'identities:write identities:delete' },
      {
        clientId: applicationClientId,
        clientSecret: fixture.clientSecret,
      },
    )

    const claims = decodeTestAccessToken(response.access_token)
    expect(claims).toMatchObject({
      sub: 'user_1',
      act: { iss: realmrootIssuer, sub: 'agent_1' },
      aud: fixture.targetResource.resourceUrl,
      client_id: applicationClientId,
      scope: 'identities:write',
    })
    expect(claims).not.toHaveProperty(realmrootOrganizationClaim)
    expect(findOrganization).toHaveBeenCalledOnce()
    expect(findOrganization).toHaveBeenCalledWith('org_1')
    expect(findMemberByOrganizationUser).not.toHaveBeenCalled()
    expect(fixture.deps.agentAudit.append).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'oauth.agent_resource_token_exchanged',
        result: 'allowed',
        scopes: ['identities:write'],
      }),
    )
  })

  it('[spec: agent-identity/agent-resource-token-delegation] delegates a second Agent Resource hop without an immediate token lease', async () => {
    const fixture = await delegatedAgentResourceFixture()

    const response = await exchangeToken(fixture.deps, fixture.input, {
      clientId: applicationClientId,
      clientSecret: fixture.clientSecret,
    })

    expect(decodeTestAccessToken(response.access_token)).toMatchObject({
      sub: 'user_1',
      act: { iss: realmrootIssuer, sub: 'agent_1' },
      aud: fixture.targetResource.resourceUrl,
      client_id: applicationClientId,
      scope: 'identities:write',
      [realmrootOrganizationClaim]: 'org_1',
    })
    expect(fixture.deps.externalResources.findActiveTokenLeaseByTokenHash).not.toHaveBeenCalled()
    expect(fixture.deps.externalResources.findAccessRequest).not.toHaveBeenCalled()
  })

  it('[spec: agent-identity/agent-resource-token-delegation] accepts the matching source policy when an earlier policy targets the same Resource', async () => {
    const fixture = await delegatedAgentResourceFixture()
    fixture.sourceApplication.tokenExchangePolicies.unshift({
      sourceResourceServerId: 'res_unrelated',
      targetResourceServerId: fixture.sourceResource.id,
      scopeMappings: [{ sourceScope: 'unrelated:read', targetScope: 'ak:agent:read' }],
    })

    await expect(
      exchangeToken(fixture.deps, fixture.input, {
        clientId: applicationClientId,
        clientSecret: fixture.clientSecret,
      }),
    ).resolves.toMatchObject({ scope: 'identities:write' })
  })

  it.each([
    {
      name: 'disabled source Application',
      mutate: ({ sourceApplication }: Awaited<ReturnType<typeof delegatedAgentResourceFixture>>) => {
        sourceApplication.disabled = true
      },
    },
    {
      name: 'cross-owner source Application',
      mutate: ({ sourceApplication }: Awaited<ReturnType<typeof delegatedAgentResourceFixture>>) => {
        sourceApplication.ownerOrganizationId = 'org_other'
      },
    },
    {
      name: 'removed source policy',
      mutate: ({ sourceApplication }: Awaited<ReturnType<typeof delegatedAgentResourceFixture>>) => {
        sourceApplication.tokenExchangePolicies = []
      },
    },
    {
      name: 'scope outside current source policy',
      mutate: ({ input }: Awaited<ReturnType<typeof delegatedAgentResourceFixture>>) => {
        input.verifiedSubjectClaims.scope = 'ak:agent:delete'
      },
    },
    {
      name: 'inactive binding on a delegated hop',
      mutate: ({ aggregate }: Awaited<ReturnType<typeof delegatedAgentResourceFixture>>) => {
        aggregate.bindings[0]!.status = 'revoked'
      },
    },
  ])('[spec: agent-identity/agent-resource-token-delegation] rejects delegated hop: $name', async ({ mutate }) => {
    const fixture = await delegatedAgentResourceFixture()
    mutate(fixture)

    await expect(
      exchangeToken(fixture.deps, fixture.input, {
        clientId: applicationClientId,
        clientSecret: fixture.clientSecret,
      }),
    ).rejects.toMatchObject({ error: 'invalid_grant' })
  })

  it('[spec: agent-identity/agent-resource-token-delegation] audits unexpected dependency failures without converting them to OAuth errors', async () => {
    const fixture = await agentResourceDelegationFixture()
    const failure = new Error('user repository unavailable')
    fixture.deps.users.getUser = async () => {
      throw failure
    }

    await expect(
      exchangeToken(fixture.deps, fixture.input, {
        clientId: applicationClientId,
        clientSecret: fixture.clientSecret,
      }),
    ).rejects.toBe(failure)
    expect(fixture.deps.agentAudit.append).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'oauth.agent_resource_token_exchanged',
        result: 'denied',
        reasonCode: 'internal_error',
        metadata: expect.objectContaining({ failureReason: 'Agent Resource token exchange failed unexpectedly.' }),
      }),
    )
  })

  const agentDelegationRejections: Array<{
    name: string
    expectedError: 'invalid_grant' | 'invalid_target'
    mutate: (fixture: Awaited<ReturnType<typeof agentResourceDelegationFixture>>) => void
  }> = [
    {
      name: 'malformed act',
      expectedError: 'invalid_grant',
      mutate: ({ input }) => {
        input.verifiedSubjectClaims.act = { iss: realmrootIssuer }
      },
    },
    {
      name: 'wrong client_id',
      expectedError: 'invalid_grant',
      mutate: ({ input }) => {
        input.verifiedSubjectClaims.client_id = 'other-client'
      },
    },
    {
      name: 'access request source Resource mismatch',
      expectedError: 'invalid_grant',
      mutate: ({ sourceRequest }) => {
        sourceRequest.resourceId = 'other-resource'
      },
    },
    {
      name: 'access request Agent identity mismatch',
      expectedError: 'invalid_grant',
      mutate: ({ sourceRequest }) => {
        sourceRequest.agentIdentityId = 'other-identity'
      },
    },
    {
      name: 'inactive Agent identity',
      expectedError: 'invalid_grant',
      mutate: ({ aggregate }) => {
        aggregate.identity.status = 'inactive'
      },
    },
    {
      name: 'deleted Agent identity',
      expectedError: 'invalid_grant',
      mutate: ({ aggregate }) => {
        aggregate.identity.deletedAt = new Date()
      },
    },
    {
      name: 'wrong binding',
      expectedError: 'invalid_grant',
      mutate: ({ lease }) => {
        lease.bindingId = 'other-binding'
      },
    },
    {
      name: 'revoked binding',
      expectedError: 'invalid_grant',
      mutate: ({ aggregate }) => {
        aggregate.bindings[0]!.status = 'revoked'
        aggregate.bindings[0]!.revokedAt = new Date()
      },
    },
    {
      name: 'identity owner and controller mismatch',
      expectedError: 'invalid_grant',
      mutate: ({ aggregate }) => {
        aggregate.identity.ownerUserId = 'other-controller'
      },
    },
    {
      name: 'disabled Organization',
      expectedError: 'invalid_grant',
      mutate: ({ deps }) => {
        deps.authorization.findOrganization = vi
          .fn()
          .mockResolvedValueOnce({ id: 'org_1', disabled: false })
          .mockResolvedValue({ id: 'org_1', disabled: true }) as never
      },
    },
    {
      name: 'missing Organization membership',
      expectedError: 'invalid_grant',
      mutate: ({ deps }) => {
        deps.authorization.findMemberByOrganizationUser = async () => null
      },
    },
    {
      name: 'source Resource unavailable to Agents',
      expectedError: 'invalid_grant',
      mutate: ({ sourceResource }) => {
        sourceResource.availableToAgents = false
      },
    },
    {
      name: 'target Resource unavailable to Agents',
      expectedError: 'invalid_target',
      mutate: ({ targetResource }) => {
        targetResource.availableToAgents = false
      },
    },
    {
      name: 'target external authorization model',
      expectedError: 'invalid_target',
      mutate: ({ targetResource }) => {
        Object.assign(targetResource, { authorizationModel: 'external' })
      },
    },
    {
      name: 'missing token exchange policy',
      expectedError: 'invalid_target',
      mutate: ({ setPolicies }) => setPolicies([]),
    },
    {
      name: 'mismatched token exchange policy',
      expectedError: 'invalid_target',
      mutate: ({ setPolicies, targetResource }) =>
        setPolicies([
          {
            sourceResourceServerId: 'other-resource',
            targetResourceServerId: targetResource.id,
            scopeMappings: [{ sourceScope: 'ak:agent:create', targetScope: 'identities:write' }],
          },
        ]),
    },
  ]

  it.each(agentDelegationRejections)('[spec: agent-identity/agent-resource-token-delegation] rejects $name', async ({
    expectedError,
    mutate,
  }) => {
    const fixture = await agentResourceDelegationFixture()
    mutate(fixture)

    await expect(
      exchangeToken(fixture.deps, fixture.input, {
        clientId: applicationClientId,
        clientSecret: fixture.clientSecret,
      }),
    ).rejects.toMatchObject({ error: expectedError })
  })

  it('rejects scope escalation during User token delegation', async () => {
    const { deps, clientSecret } = await tokenExchangeFixture({ scopes: ['agents:write'] })
    const findApplication = deps.applications.findByClientId
    deps.applications.findByClientId = async (clientId) => {
      const application = await findApplication(clientId)
      return application
        ? {
            ...application,
            tokenExchangePolicies: [
              {
                sourceResourceServerId: audienceResourceId,
                targetResourceServerId: audienceResourceId,
                scopeMappings: [{ sourceScope: 'agents:write', targetScope: 'agents:write' }],
              },
            ],
          }
        : null
    }
    const input = {
      grantType: tokenExchangeGrantType,
      subjectToken: 'verified-by-http-adapter',
      subjectTokenType: accessTokenType,
      audience: defaultAudience,
      scope: 'agents:write',
      verifiedSubjectClaims: {
        iss: realmrootIssuer,
        sub: 'user_1',
        aud: defaultAudience,
        scope: 'agents:read',
        exp: Math.floor(Date.now() / 1000) + 600,
      },
    }
    await expect(exchangeToken(deps, input, { clientId: applicationClientId, clientSecret })).rejects.toMatchObject({
      error: 'invalid_scope',
    })
  })

  it('exchanges an active policy-bound Agent token for an OIDC ID token and audits revocation [spec: agent-identity/agent-oidc-id-token-exchange]', async () => {
    const { repository, deps, clientSecret } = await tokenExchangeFixture({ scopes: [] })
    const sourceResource = eligibleAudienceResource(['workload:read'])
    const targetApplication = {
      id: 'app_oidc',
      clientId: 'oidc-client',
      clientType: 'confidential_web',
      visibility: 'private',
      disabled: false,
      ownerOrganizationId: 'org_1',
      oidcScopes: ['openid', 'profile', 'email', 'groups', 'offline_access'],
    }
    const findApplication = deps.applications.findByClientId
    let policyEnabled = true
    deps.applications.findByClientId = async (clientId) => {
      if (clientId === targetApplication.clientId) return targetApplication as never
      const application = await findApplication(clientId)
      return application
        ? {
            ...application,
            tokenExchangePolicies: policyEnabled
              ? [
                  {
                    sourceResourceServerId: sourceResource.id,
                    targetApplicationId: targetApplication.id,
                  },
                ]
              : [],
          }
        : null
    }
    deps.authorization.findResourceByResourceUrl = async (audience) =>
      (audience === sourceResource.resourceUrl ? sourceResource : null) as never
    deps.authorization.findOrganization = async () => ({ id: 'org_1', disabled: false }) as never
    deps.authorization.findMemberByOrganizationUser = async () => ({ id: 'member_1' }) as never
    deps.authorization.listTeamNamesForUser = async () => ['platform-operators']
    const identity = {
      id: 'agent_identity_1',
      issuer: realmrootIssuer,
      subject: 'agent_1',
      ownerUserId: 'user_1',
      ownerOrganizationId: null,
      status: 'active',
      deletedAt: null,
    }
    deps.agentIdentities = {
      findByIssuerSubject: vi.fn().mockResolvedValue(identity),
      findIdentity: vi.fn().mockResolvedValue({
        identity,
        bindings: [{ id: 'binding_1', status: 'active', revokedAt: null }],
      }),
    } as never
    const activeLease = { id: 'lease_1', requestId: 'request_1', bindingId: 'binding_1' }
    deps.externalResources = {
      findActiveTokenLeaseByTokenHash: vi.fn().mockResolvedValue(activeLease),
      findAccessRequest: vi.fn().mockResolvedValue({
        id: 'request_1',
        resourceId: sourceResource.id,
        agentIdentityId: identity.id,
      }),
    } as never
    deps.agentAudit = { append: vi.fn().mockResolvedValue(undefined) } as never
    const signer = {
      issuer: realmrootIssuer,
      sign: vi.fn(async (payload: Record<string, unknown>) => testAccessToken(payload)),
    }
    const input = {
      grantType: tokenExchangeGrantType,
      subjectToken: 'active-agent-token',
      subjectTokenType: accessTokenType,
      requestedTokenType: idTokenType,
      audience: targetApplication.clientId,
      scope: 'openid groups',
      verifiedSubjectClaims: {
        iss: realmrootIssuer,
        sub: 'user_1',
        aud: sourceResource.resourceUrl,
        jti: 'resat_1',
        client_id: 'realmroot-cli',
        exp: Math.floor(Date.now() / 1000) + 600,
        [realmrootOrganizationClaim]: 'org_1',
        act: { iss: realmrootIssuer, sub: 'agent_1' },
      },
    }

    const response = await exchangeTokenVerified(deps, input, { clientId: applicationClientId, clientSecret }, signer)

    expect(response).toMatchObject({
      issued_token_type: idTokenType,
      token_type: 'Bearer',
      scope: 'openid groups',
    })
    expect(response).not.toHaveProperty('refresh_token')
    expect(decodeTestAccessToken(response.access_token)).toMatchObject({
      sub: 'user_1',
      aud: targetApplication.clientId,
      azp: applicationClientId,
      act: { iss: realmrootIssuer, sub: 'agent_1' },
      groups: ['platform-operators'],
      [realmrootOrganizationClaim]: 'org_1',
    })
    expect(decodeTestAccessToken(response.access_token)).not.toHaveProperty('scope')
    expect(signer.sign).toHaveBeenCalledWith(expect.any(Object), 'JWT')
    expect(deps.agentAudit.append).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'oauth.agent_identity_token_exchanged',
        result: 'allowed',
        realmOwned: false,
        ownerOrganizationId: 'org_1',
      }),
    )

    repository.client = {
      ...repository.client!,
      grantTypes: JSON.stringify(['client_credentials']),
    }
    await expect(
      exchangeTokenVerified(deps, input, { clientId: applicationClientId, clientSecret }, signer),
    ).rejects.toMatchObject({ error: 'unauthorized_client' })
    expect(deps.agentAudit.append).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'oauth.agent_identity_token_exchanged',
        result: 'denied',
        ownerOrganizationId: 'org_1',
        reasonCode: 'unauthorized_client',
      }),
    )
    repository.client = {
      ...repository.client!,
      grantTypes: JSON.stringify([tokenExchangeGrantType]),
    }

    vi.mocked(deps.externalResources.findActiveTokenLeaseByTokenHash).mockResolvedValueOnce(null)
    await expect(
      exchangeTokenVerified(deps, input, { clientId: applicationClientId, clientSecret }, signer),
    ).rejects.toMatchObject({ error: 'invalid_grant' })
    expect(deps.agentAudit.append).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'oauth.agent_identity_token_exchanged',
        result: 'denied',
        reasonCode: 'invalid_grant',
        metadata: expect.objectContaining({ failureReason: 'Agent subject token is inactive or revoked.' }),
      }),
    )

    vi.mocked(deps.externalResources.findActiveTokenLeaseByTokenHash).mockResolvedValue(activeLease as never)
    for (const verifiedSubjectClaims of [
      undefined,
      { ...input.verifiedSubjectClaims, client_id: 'wrong-client' },
      { ...input.verifiedSubjectClaims, act: undefined },
      { ...input.verifiedSubjectClaims, exp: 1 },
      { ...input.verifiedSubjectClaims, [realmrootOrganizationClaim]: undefined },
      { ...input.verifiedSubjectClaims, [realmrootOrganizationClaim]: 'org_other' },
      { ...input.verifiedSubjectClaims, aud: 'https://wrong-source.example.com' },
    ]) {
      await expect(
        exchangeTokenVerified(
          deps,
          { ...input, verifiedSubjectClaims },
          { clientId: applicationClientId, clientSecret },
          signer,
        ),
      ).rejects.toBeInstanceOf(Error)
    }

    await expect(
      exchangeTokenVerified(
        deps,
        { ...input, audience: 'unknown-oidc-client' },
        { clientId: applicationClientId, clientSecret },
        signer,
      ),
    ).rejects.toMatchObject({ error: 'invalid_target' })

    vi.mocked(deps.agentIdentities.findByIssuerSubject).mockResolvedValueOnce(null)
    await expect(
      exchangeTokenVerified(deps, input, { clientId: applicationClientId, clientSecret }, signer),
    ).rejects.toMatchObject({ error: 'invalid_grant' })

    policyEnabled = false
    await expect(
      exchangeTokenVerified(deps, input, { clientId: applicationClientId, clientSecret }, signer),
    ).rejects.toMatchObject({ error: 'invalid_target' })
    policyEnabled = true

    targetApplication.disabled = true
    await expect(
      exchangeTokenVerified(deps, input, { clientId: applicationClientId, clientSecret }, signer),
    ).rejects.toMatchObject({ error: 'invalid_target' })
    targetApplication.disabled = false

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValueOnce({
      identity: { ...identity, status: 'inactive' },
      bindings: [{ id: 'binding_1', status: 'active', revokedAt: null }],
    } as never)
    await expect(
      exchangeTokenVerified(deps, input, { clientId: applicationClientId, clientSecret }, signer),
    ).rejects.toMatchObject({ error: 'invalid_grant' })

    deps.authorization.findMemberByOrganizationUser = async () => null
    await expect(
      exchangeTokenVerified(deps, input, { clientId: applicationClientId, clientSecret }, signer),
    ).rejects.toMatchObject({ error: 'invalid_grant' })

    deps.authorization.findMemberByOrganizationUser = async () => ({ id: 'member_1' }) as never
    await expect(
      exchangeTokenVerified(
        deps,
        { ...input, scope: 'openid' },
        { clientId: applicationClientId, clientSecret },
        signer,
      ),
    ).rejects.toMatchObject({ error: 'invalid_scope' })

    const verifier = { verify: vi.fn().mockRejectedValue(new Error('invalid signature')) }
    const unverifiedSubjectToken = await signEs256TestJwt(
      { aud: sourceResource.resourceUrl },
      'untrusted-subject-token',
    )
    await expect(
      exchangeTokenVerified(
        deps,
        {
          ...input,
          subjectToken: unverifiedSubjectToken,
          verifiedSubjectClaims: undefined,
        },
        { clientId: applicationClientId, clientSecret },
        signer,
        verifier,
      ),
    ).rejects.toMatchObject({ error: 'invalid_grant' })
    expect(verifier.verify).toHaveBeenCalledOnce()
    expect(deps.agentAudit.append).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'oauth.agent_identity_token_exchanged',
        result: 'denied',
        ownerOrganizationId: 'org_1',
        reasonCode: 'invalid_grant',
      }),
    )

    verifier.verify.mockClear()
    await expect(
      exchangeTokenVerified(
        deps,
        { ...input, verifiedSubjectClaims: undefined },
        { clientId: applicationClientId, clientSecret: 'wrong-secret' },
        signer,
        verifier,
      ),
    ).rejects.toMatchObject({ error: 'invalid_client' })
    expect(verifier.verify).not.toHaveBeenCalled()
    expect(deps.agentAudit.append).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'oauth.agent_identity_token_exchanged',
        result: 'denied',
        realmOwned: true,
        ownerOrganizationId: null,
        reasonCode: 'invalid_client',
      }),
    )

    await expect(
      exchangeTokenVerified(
        deps,
        { ...input, subjectTokenType: jwtTokenType },
        { clientId: applicationClientId, clientSecret },
        signer,
      ),
    ).rejects.toMatchObject({ error: 'invalid_request' })
    expect(deps.agentAudit.append).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'oauth.agent_identity_token_exchanged',
        result: 'denied',
        ownerOrganizationId: 'org_1',
        reasonCode: 'invalid_request',
      }),
    )
  })

  it('rejects invalid, expired, inactive, and unconfigured User token delegation subjects', async () => {
    const { deps, clientSecret } = await tokenExchangeFixture({ scopes: ['agents:write'] })
    const sourceResource = eligibleAudienceResource(['agents:write'])
    const targetResource = {
      ...eligibleAudienceResource(['agents:write']),
      id: 'res_realmroot',
      resourceUrl: 'https://auth.example.com/api',
    }
    const findApplication = deps.applications.findByClientId
    deps.applications.findByClientId = async (clientId) => {
      const application = await findApplication(clientId)
      return application
        ? {
            ...application,
            tokenExchangePolicies: [
              {
                sourceResourceServerId: sourceResource.id,
                targetResourceServerId: targetResource.id,
                scopeMappings: [{ sourceScope: 'agents:write', targetScope: 'agents:write' }],
              },
            ],
            resourceScopes: [{ resourceServerId: targetResource.id, scopes: ['agents:write'] }],
          }
        : null
    }
    deps.authorization.findResourceByResourceUrl = async (resourceUrl) =>
      (resourceUrl === sourceResource.resourceUrl
        ? sourceResource
        : resourceUrl === targetResource.resourceUrl
          ? targetResource
          : null) as never
    const validClaims = {
      iss: realmrootIssuer,
      sub: 'user_1',
      aud: sourceResource.resourceUrl,
      scope: 'agents:write',
      exp: Math.floor(Date.now() / 1000) + 600,
    }
    const input = {
      grantType: tokenExchangeGrantType,
      subjectToken: 'verified-by-http-adapter',
      subjectTokenType: accessTokenType,
      audience: targetResource.resourceUrl,
      scope: 'agents:write',
      verifiedSubjectClaims: validClaims,
    } as const

    for (const verifiedSubjectClaims of [
      { ...validClaims, iss: 'https://other.example/api/auth' },
      { ...validClaims, aud: [sourceResource.resourceUrl, 'https://other.example/api'] },
      { ...validClaims, exp: Math.floor(Date.now() / 1000) - 1 },
      { ...validClaims, [realmrootOrganizationClaim]: ['org_1'] },
    ]) {
      await expect(
        exchangeToken(deps, { ...input, verifiedSubjectClaims }, { clientId: applicationClientId, clientSecret }),
      ).rejects.toMatchObject({ error: 'invalid_grant' })
    }

    deps.users.getUser = async (id) => ({ id, banned: true }) as never
    await expect(exchangeToken(deps, input, { clientId: applicationClientId, clientSecret })).rejects.toMatchObject({
      error: 'invalid_grant',
    })

    deps.users.getUser = async (id) => ({ id, banned: false }) as never
    deps.authorization.findResourceByResourceUrl = async (resourceUrl) =>
      (resourceUrl === sourceResource.resourceUrl ? sourceResource : null) as never
    await expect(exchangeToken(deps, input, { clientId: applicationClientId, clientSecret })).rejects.toMatchObject({
      error: 'invalid_target',
    })

    deps.authorization.findResourceByResourceUrl = async (resourceUrl) =>
      (resourceUrl === targetResource.resourceUrl ? targetResource : null) as never
    await expect(exchangeToken(deps, input, { clientId: applicationClientId, clientSecret })).rejects.toMatchObject({
      error: 'invalid_grant',
    })
  })

  it('rejects delegated target scopes that are unavailable or refresh-capable', async () => {
    const { deps, clientSecret } = await tokenExchangeFixture({ scopes: ['offline_access'] })
    const sourceResource = eligibleAudienceResource(['offline_access'])
    const targetResource = {
      ...eligibleAudienceResource(['offline_access']),
      id: 'res_realmroot',
      resourceUrl: 'https://auth.example.com/api',
    }
    const findApplication = deps.applications.findByClientId
    deps.applications.findByClientId = async (clientId) => {
      const application = await findApplication(clientId)
      return application
        ? {
            ...application,
            tokenExchangePolicies: [
              {
                sourceResourceServerId: sourceResource.id,
                targetResourceServerId: targetResource.id,
                scopeMappings: [{ sourceScope: 'offline_access', targetScope: 'offline_access' }],
              },
            ],
            oidcScopes: ['offline_access'],
            resourceScopes: [],
          }
        : null
    }
    deps.authorization.findResourceByResourceUrl = async (resourceUrl) =>
      (resourceUrl === sourceResource.resourceUrl
        ? sourceResource
        : resourceUrl === targetResource.resourceUrl
          ? targetResource
          : null) as never
    const baseInput = {
      grantType: tokenExchangeGrantType,
      subjectToken: 'verified-by-http-adapter',
      subjectTokenType: accessTokenType,
      audience: targetResource.resourceUrl,
      verifiedSubjectClaims: {
        iss: realmrootIssuer,
        sub: 'user_1',
        aud: sourceResource.resourceUrl,
        scope: 'offline_access',
        exp: Math.floor(Date.now() / 1000) + 600,
      },
    } as const

    await expect(
      exchangeToken(deps, { ...baseInput, scope: 'offline_access' }, { clientId: applicationClientId, clientSecret }),
    ).rejects.toMatchObject({ error: 'invalid_scope' })
    await expect(
      exchangeToken(deps, { ...baseInput, scope: '' }, { clientId: applicationClientId, clientSecret }),
    ).rejects.toMatchObject({ error: 'invalid_scope' })
  })

  it('recognizes opaque and stored token-exchange access tokens', async () => {
    const { deps } = await tokenExchangeFixture()

    await expect(isTokenExchangeAccessToken(deps, 'fatx_opaque')).resolves.toBe(true)
    await expect(isTokenExchangeAccessToken(deps, 'not-stored')).resolves.toBe(false)
  })

  it('reads only one unverified subject-token audience for HTTP boundary routing', () => {
    const token = (aud: string[]) =>
      `${base64UrlString('{"alg":"RS256"}')}.${base64UrlString(JSON.stringify({ aud }))}.c2ln`

    expect(unverifiedSubjectTokenAudience(token(['https://api.example']))).toBe('https://api.example')
    expect(unverifiedSubjectTokenAudience(token(['https://one.example', 'https://two.example']))).toBe(null)
  })

  it('rejects an audience outside the Application Organization tenant', async () => {
    const repository = new InMemoryTokenExchangeRepository()
    const deps = credentialDeps(repository)
    deps.authorization.findResource = async () =>
      ({
        ...eligibleAudienceResource(),
        ownerOrganizationId: 'org_2',
      }) as never

    await expect(
      createFederatedCredential(deps, applicationId, {
        name: 'Cross tenant',
        issuer: 'https://platform.example.com',
        subject: 'org_1:*',
        audienceResourceId,
        publicKeys: [{ kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }],
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('matches an exact federated credential subject', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture({ seedCredential: false })
    await repository.seedCredential({
      issuer: 'https://platform.example.com',
      subject: 'org_1:runner_1',
    })
    const subjectToken = await signEs256TestJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: defaultAudience,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
    )

    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          requestedTokenType: accessTokenType,
          audience: defaultAudience,
          scope: 'runner:connect',
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).resolves.toMatchObject({ token_type: 'Bearer' })
  })

  it('rejects a credential from a different Organization for private and public Applications', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture({ seedCredential: false })
    await repository.seedCredential({
      issuer: 'https://platform.example.com',
      subject: 'org_2:runner_1',
      ownerOrganizationId: 'org_2',
    })
    const subjectToken = await signEs256TestJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_2:runner_1',
        aud: defaultAudience,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
    )

    const input = {
      grantType: tokenExchangeGrantType,
      subjectToken,
      subjectTokenType: jwtTokenType,
      requestedTokenType: accessTokenType,
      audience: defaultAudience,
      scope: 'runner:connect',
    } as const
    await expect(exchangeToken(deps, input, { clientId: applicationClientId, clientSecret })).rejects.toMatchObject({
      status: 400,
    })

    const findApplication = deps.applications.findByClientId
    deps.applications.findByClientId = async (clientId) => {
      const application = await findApplication(clientId)
      return application ? { ...application, visibility: 'public' } : null
    }
    await expect(exchangeToken(deps, input, { clientId: applicationClientId, clientSecret })).rejects.toMatchObject({
      status: 400,
    })
  })

  it('rejects client authentication when the Application Organization is disabled', async () => {
    const { deps, clientSecret } = await tokenExchangeFixture()
    deps.authorization.findOrganization = async () => ({ id: 'org_1', disabled: true }) as never

    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken: 'unused',
          subjectTokenType: jwtTokenType,
          requestedTokenType: accessTokenType,
          audience: defaultAudience,
          scope: 'runner:connect',
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ error: 'invalid_client', status: 401 })
  })

  it('exchanges a trusted external JWT assertion for an introspectable access token [spec: agent-identity/workload-token-exchange-claims]', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture()

    const subjectToken = await signEs256TestJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: defaultAudience,
        exp: Math.floor(Date.now() / 1000) + 60,
        ama_project_id: 'project_1',
        ama_environment_id: 'env_1',
        ama_runner_id: 'runner_1',
        runner_capabilities: ['session:poll', 'session:claim'],
        active: false,
        client_id: 'attacker-client',
        scope: 'admin',
        token_type: 'attacker',
      },
      'external-platform-secret',
    )

    const exchanged = await exchangeToken(
      deps,
      {
        grantType: tokenExchangeGrantType,
        subjectToken,
        subjectTokenType: jwtTokenType,
        requestedTokenType: accessTokenType,
        audience: defaultAudience,
        scope: 'runner:connect',
      },
      { clientId: applicationClientId, clientSecret },
    )

    expect(exchanged).toMatchObject({
      issued_token_type: accessTokenType,
      token_type: 'Bearer',
      scope: 'runner:connect',
    })
    expect(exchanged.expires_in).toBeGreaterThan(0)
    expect(exchanged.expires_in).toBeLessThanOrEqual(60)
    const accessPayload = decodeTestAccessToken(exchanged.access_token)
    expect(accessPayload).toMatchObject({
      iss: realmrootIssuer,
      sub: 'org_1:runner_1',
      aud: defaultAudience,
      client_id: applicationClientId,
      scope: 'runner:connect',
      'urn:realmroot:params:oauth:org': 'org_1',
      jti: expect.any(String),
    })
    expect(accessPayload).not.toHaveProperty('ama_project_id')
    expect(accessPayload).not.toHaveProperty('ama_environment_id')
    expect(accessPayload).not.toHaveProperty('ama_runner_id')
    expect(accessPayload).not.toHaveProperty('runner_capabilities')
    expect(accessPayload).not.toHaveProperty('active')
    expect(accessPayload).not.toHaveProperty('token_type')

    await expect(
      introspectToken(deps, exchanged.access_token, { clientId: applicationClientId, clientSecret }, realmrootIssuer),
    ).resolves.toMatchObject({
      active: true,
      iss: realmrootIssuer,
      sub: 'org_1:runner_1',
      aud: defaultAudience,
      client_id: applicationClientId,
      scope: 'runner:connect',
      'urn:realmroot:params:oauth:org': 'org_1',
    })
    await expect(
      introspectTokenVerified(
        deps,
        exchanged.access_token,
        { clientId: applicationClientId, clientSecret },
        realmrootIssuer,
        { verify: async () => ({ ...accessPayload, scope: 'tampered' }) },
      ),
    ).resolves.toEqual({ active: false })
    await expect(
      introspectTokenVerified(
        deps,
        exchanged.access_token,
        { clientId: applicationClientId, clientSecret },
        realmrootIssuer,
        { verify: async () => Promise.reject(new Error('invalid signature')) },
      ),
    ).resolves.toEqual({ active: false })

    repository.client = {
      ...repository.client!,
      clientId: 'other-client',
      clientSecret: await hashProviderSecret('other-client-secret'),
    }
    await expect(
      introspectToken(
        deps,
        exchanged.access_token,
        { clientId: 'other-client', clientSecret: 'other-client-secret' },
        realmrootIssuer,
      ),
    ).resolves.toEqual({ active: false })
    repository.client = {
      ...repository.client!,
      clientId: applicationClientId,
      clientSecret: await hashProviderSecret(clientSecret),
    }

    repository.expireTokens()
    await expect(
      introspectToken(deps, exchanged.access_token, { clientId: applicationClientId, clientSecret }, realmrootIssuer),
    ).resolves.toEqual({
      active: false,
    })
    repository.unexpireTokens()
    repository.revokeTokens()
    await expect(
      introspectToken(deps, exchanged.access_token, { clientId: applicationClientId, clientSecret }, realmrootIssuer),
    ).resolves.toEqual({
      active: false,
    })
  })

  it('keeps previously issued opaque exchange tokens introspectable during migration', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture()
    const token = 'fatx_legacy-token'
    await repository.storeAccessToken({
      id: 'legacy-token-1',
      tokenHash: await hashProviderSecret(token),
      clientId: applicationClientId,
      credentialId: 'fcr_1',
      subject: 'org_1:runner_1',
      subjectTokenIssuer: 'https://platform.example.com',
      audience: defaultAudience,
      scopes: ['runner:connect'],
      claims: { ama_runner_id: 'runner_1' },
      expiresAt: new Date(Date.now() + 60_000),
    })

    await expect(
      introspectToken(deps, token, { clientId: applicationClientId, clientSecret }, realmrootIssuer),
    ).resolves.toMatchObject({
      active: true,
      sub: 'org_1:runner_1',
      client_id: applicationClientId,
      'urn:realmroot:params:oauth:token-exchange:subject-claims': { ama_runner_id: 'runner_1' },
    })
  })

  it('refreshes token-exchange access tokens with a signed refresh token', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture({
      grantTypes: [tokenExchangeGrantType, refreshTokenGrantType],
      scopes: ['runner:connect', 'offline_access'],
    })

    const subjectToken = await signEs256TestJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: defaultAudience,
        exp: Math.floor(Date.now() / 1000) + 60,
        ama_project_id: 'project_1',
        ama_environment_id: 'env_1',
      },
      'external-platform-secret',
    )

    const exchanged = await exchangeToken(
      deps,
      {
        grantType: tokenExchangeGrantType,
        subjectToken,
        subjectTokenType: jwtTokenType,
        requestedTokenType: accessTokenType,
        audience: defaultAudience,
        scope: 'runner:connect offline_access',
      },
      { clientId: applicationClientId, clientSecret },
    )

    expect(exchanged.refresh_token).toMatch(/^fatr_/)
    repository.injectLegacyRefreshClaims({
      client_id: 'attacker-client',
      scope: 'admin',
      act: { iss: 'https://attacker.example.com', sub: 'attacker' },
      token_type: 'attacker',
    })
    const refreshed = await refreshToken(
      deps,
      {
        grantType: refreshTokenGrantType,
        refreshToken: exchanged.refresh_token!,
        scope: 'runner:connect',
      },
      { clientId: applicationClientId, clientSecret },
    )

    expect(refreshed).toMatchObject({
      issued_token_type: accessTokenType,
      token_type: 'Bearer',
      scope: 'runner:connect',
    })
    const refreshedPayload = decodeTestAccessToken(refreshed.access_token)
    expect(refreshedPayload).toMatchObject({
      sub: 'org_1:runner_1',
      client_id: applicationClientId,
      scope: 'runner:connect',
    })
    expect(refreshedPayload).not.toHaveProperty('token_type')
    await expect(
      introspectToken(deps, refreshed.access_token, { clientId: applicationClientId, clientSecret }, realmrootIssuer),
    ).resolves.toMatchObject({
      active: true,
      iss: realmrootIssuer,
      sub: 'org_1:runner_1',
      aud: defaultAudience,
      client_id: applicationClientId,
      scope: 'runner:connect',
      'urn:realmroot:params:oauth:org': 'org_1',
    })
  })

  it('rejects disallowed audiences and inactive exchanged tokens', async () => {
    const { deps, clientSecret } = await tokenExchangeFixture()
    const subjectToken = await signEs256TestJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: 'https://other.example.com',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
    )

    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://other.example.com',
          scope: 'runner:connect',
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: 'urn:example:unsupported',
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400, error: 'invalid_request' })

    await expect(
      introspectToken(deps, 'missing-token', { clientId: applicationClientId, clientSecret }, realmrootIssuer),
    ).resolves.toEqual({
      active: false,
    })
  })

  it('exchanges a trusted RS256 JWT assertion from JWKS', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture({ seedCredential: false })
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'ak-key-1', alg: 'RS256' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await repository.seedCredential({
      issuer: 'https://platform.example.com',
      jwksUrl: 'https://platform.example.com/.well-known/jwks.json',
    })

    const subjectToken = await signRs256Jwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: [defaultAudience],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      keyPair.privateKey,
      'ak-key-1',
    )

    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
          scope: 'runner:connect',
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).resolves.toMatchObject({
      issued_token_type: accessTokenType,
      token_type: 'Bearer',
    })
  })

  it('exchanges a trusted ES256 JWT assertion from JWKS', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture({ seedCredential: false })
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'ak-key-1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await repository.seedCredential({
      issuer: 'https://platform.example.com',
      jwksUrl: 'https://platform.example.com/.well-known/jwks.json',
    })

    const subjectToken = await signEs256Jwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: defaultAudience,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      keyPair.privateKey,
      'ak-key-1',
    )

    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
          scope: 'runner:connect',
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).resolves.toMatchObject({
      issued_token_type: accessTokenType,
      token_type: 'Bearer',
    })
  })

  it('rejects unsupported JWKS algorithms', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture({ seedCredential: false })
    await repository.seedCredential({
      issuer: 'https://platform.example.com',
      jwksUrl: 'https://platform.example.com/.well-known/jwks.json',
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ kty: 'oct', k: 'secret', kid: 'ak-key-1', alg: 'HS384' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const subjectToken = await signHs384HeaderJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: defaultAudience,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
      'ak-key-1',
    )

    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects invalid client and subject token boundaries', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture({ seedCredential: false })

    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken: 'invalid',
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret: null },
      ),
    ).rejects.toMatchObject({ status: 401, error: 'invalid_client' })

    await expect(
      createFederatedCredential(deps, applicationId, {
        name: 'No Key',
        issuer: 'https://platform.example.com',
        subject: 'org_1:*',
        audienceResourceId,
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      createFederatedCredential(deps, applicationId, {
        name: 'Private JWKS URL',
        issuer: 'https://platform.example.com',
        subject: 'org_1:*',
        audienceResourceId,
        jwksUrl: 'http://127.0.0.1/jwks',
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      createFederatedCredential(deps, applicationId, {
        name: 'Private key material',
        issuer: 'https://platform.example.com',
        subject: 'org_1:*',
        audienceResourceId,
        publicKeys: [
          {
            kty: 'EC',
            crv: 'P-256',
            x: 'public-x',
            y: 'public-y',
            d: 'private-key',
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 })

    await repository.seedCredential({ issuer: 'https://platform.example.com' })

    const expiredSubjectToken = await signEs256TestJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: defaultAudience,
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      'external-platform-secret',
    )
    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken: expiredSubjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
          scope: 'runner:connect',
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })

    const futureSubjectToken = await signEs256TestJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: defaultAudience,
        nbf: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
    )
    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken: futureSubjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
          scope: 'runner:connect',
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })

    const validSubjectToken = await signEs256TestJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: defaultAudience,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
    )
    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken: validSubjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
          scope: 'runner:admin',
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('parses OAuth basic client authorization headers', () => {
    expect(parseBasicClientAuthorization(null)).toBeNull()
    expect(parseBasicClientAuthorization('Bearer token')).toBeNull()
    expect(parseBasicClientAuthorization(`Basic ${btoa('missing-colon')}`)).toBeNull()
    expect(parseBasicClientAuthorization(`Basic ${btoa('runner%20client:runner%2Fsecret')}`)).toEqual({
      clientId: 'runner client',
      clientSecret: 'runner/secret',
    })
    expect(parseBasicClientAuthorization('Basic %%%')).toBeNull()
    expect(parseBasicClientAuthorization(`Basic ${btoa('%:secret')}`)).toBeNull()
  })

  it('validates federated JWKS URLs and public verification keys at the configuration boundary', async () => {
    const { deps } = await tokenExchangeFixture({ seedCredential: false })
    const base = {
      issuer: 'https://platform.example.com',
      subject: 'org_1:*',
      audienceResourceId,
    }

    for (const jwksUrl of [
      'not-a-url',
      'http://keys.example.com/jwks',
      'https://user@keys.example.com/jwks',
      'https://keys.example.com/jwks#fragment',
      'https://localhost/jwks',
      'https://keys.localhost/jwks',
      'https://keys.local/jwks',
      'https://[::1]/jwks',
      'https://[fc00::1]/jwks',
      'https://[fd00::1]/jwks',
      'https://[fe80::1]/jwks',
      'https://10.0.0.1/jwks',
      'https://127.0.0.1/jwks',
      'https://169.254.1.1/jwks',
      'https://172.16.0.1/jwks',
      'https://192.168.1.1/jwks',
      'https://0.1.2.3/jwks',
    ]) {
      await expect(
        createFederatedCredential(deps, applicationId, { ...base, name: jwksUrl, jwksUrl }),
      ).rejects.toMatchObject({ status: 400 })
    }
    for (const jwksUrl of ['https://keys.example.com/jwks', 'https://8.8.8.8/jwks']) {
      await expect(
        createFederatedCredential(deps, applicationId, { ...base, name: jwksUrl, jwksUrl }),
      ).resolves.toMatchObject({ jwksUrl })
    }

    const rsa = { kty: 'RSA', kid: 'rsa-1', alg: 'RS256', n: 'modulus', e: 'AQAB' }
    const ec = { kty: 'EC', kid: 'ec-1', alg: 'ES256', crv: 'P-256', x: 'x', y: 'y' }
    const invalidKeySets: Record<string, unknown>[][] = [
      [
        { ...rsa, kid: undefined },
        { ...ec, kid: undefined },
      ],
      [rsa, { ...rsa }],
      [{ ...rsa, use: 'enc' }],
      [{ ...rsa, key_ops: 'verify' }],
      [{ ...rsa, key_ops: ['sign'] }],
      [{ ...rsa, key_ops: ['verify', 'sign'] }],
      [{ ...rsa, d: 'private' }],
      [{ ...rsa, p: 'private' }],
      [{ ...rsa, q: 'private' }],
      [{ ...rsa, dp: 'private' }],
      [{ ...rsa, dq: 'private' }],
      [{ ...rsa, qi: 'private' }],
      [{ ...rsa, k: 'symmetric' }],
      [{ ...rsa, alg: 'RS512' }],
      [{ ...rsa, n: undefined }],
      [{ ...rsa, e: undefined }],
      [{ ...ec, alg: 'ES384' }],
      [{ ...ec, crv: 'P-384' }],
      [{ ...ec, x: undefined }],
      [{ ...ec, y: undefined }],
      [{ kty: 'oct', kid: 'oct-1', alg: 'HS256', k: 'secret' }],
    ]
    for (const publicKeys of invalidKeySets) {
      await expect(
        createFederatedCredential(deps, applicationId, {
          ...base,
          name: JSON.stringify(publicKeys),
          publicKeys,
        }),
      ).rejects.toMatchObject({ status: 400 })
    }
    await expect(
      createFederatedCredential(deps, applicationId, {
        ...base,
        name: 'Valid verification keys',
        publicKeys: [{ kty: 'RSA', n: 'modulus', e: 'AQAB', key_ops: ['verify'] }],
      }),
    ).resolves.toMatchObject({ enabled: true })
  })

  it('rejects unsupported exchange inputs and untrusted client states', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture()
    const subjectToken = await signEs256TestJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: defaultAudience,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
    )

    await expect(
      exchangeToken(
        deps,
        {
          grantType: 'client_credentials',
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: accessTokenType,
          audience: defaultAudience,
          verifiedSubjectClaims: {},
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          requestedTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })

    repository.client = { ...repository.client!, disabled: true }
    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 401, error: 'invalid_client' })

    repository.client = { ...repository.client!, disabled: false, grantTypes: JSON.stringify(['client_credentials']) }
    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects invalid subject token signer states', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture()
    const unsignedSubjectToken = await signEs256TestJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: defaultAudience,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'wrong-secret',
    )

    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken: unsignedSubjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })

    repository.clearCredentials()
    await repository.seedCredential({
      issuer: 'https://platform.example.com',
      jwksUrl: 'https://platform.example.com/.well-known/jwks.json',
    })
    const hsSubjectToken = await signJwtWithHeader(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: defaultAudience,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
      { alg: 'HS256', typ: 'JWT' },
    )
    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken: hsSubjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })

    const rsHeaderSubjectToken = await signJwtWithHeader(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: defaultAudience,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
      { alg: 'RS256', typ: 'JWT', kid: 'ak-key-1' },
    )
    repository.clearCredentials()
    await repository.seedCredential({ issuer: 'https://platform.example.com' })
    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken: rsHeaderSubjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects unavailable or unmatched JWKS signing keys', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture({ seedCredential: false })
    await repository.seedCredential({
      issuer: 'https://platform.example.com',
      jwksUrl: 'https://platform.example.com/.well-known/jwks.json',
    })
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )
    const subjectToken = await signRs256Jwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: defaultAudience,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      keyPair.privateKey,
      'ak-key-1',
    )

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('not found', { status: 404 }))
    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ keys: [{ kid: 'other-key', alg: 'RS256' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ notKeys: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })

    const otherKeyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )
    const jwk = await crypto.subtle.exportKey('jwk', otherKeyPair.publicKey)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'ak-key-1', alg: 'RS256' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })

    repository.clearCredentials()
    await repository.seedCredential({
      issuer: 'https://platform.example.com',
      publicKeys: null,
    })
    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken: await signEs256TestJwt(
            {
              iss: 'https://platform.example.com',
              sub: 'org_1:runner_1',
              aud: defaultAudience,
              exp: Math.floor(Date.now() / 1000) + 60,
            },
            'external-platform-secret',
          ),
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400, error: 'invalid_grant' })

    const signingJwk = await defaultSigningJwk()
    repository.clearCredentials()
    await repository.seedCredential({
      issuer: 'https://platform.example.com',
      publicKeys: [
        { ...signingJwk, kid: 'key-1', alg: 'ES256' },
        { ...signingJwk, kid: 'key-2', alg: 'ES256' },
      ],
    })
    const noKidToken = await signJwtWithHeader(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: defaultAudience,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
      { alg: 'ES256', typ: 'JWT' },
    )
    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken: noKidToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400, error: 'invalid_grant' })
  })

  it('lists federated credentials and rejects invalid client secrets', async () => {
    const { deps } = await tokenExchangeFixture()

    await expect(listFederatedCredentials(deps, applicationId)).resolves.toHaveLength(1)
    await expect(
      introspectToken(
        deps,
        'missing-token',
        { clientId: applicationClientId, clientSecret: 'wrong-secret' },
        realmrootIssuer,
      ),
    ).rejects.toMatchObject({
      status: 401,
    })
  })

  it('manages federated credential CRUD boundaries', async () => {
    const { deps, repository } = await tokenExchangeFixture({ seedCredential: false })

    await expect(listFederatedCredentials(deps, 'missing-app')).rejects.toMatchObject({ status: 404 })
    await expect(
      createFederatedCredential(deps, applicationId, {
        name: 'Bad audience',
        issuer: 'https://platform.example.com',
        subject: 'org_1:*',
        audienceResourceId: 'missing-resource',
        jwksUrl: 'https://platform.example.com/jwks',
      }),
    ).rejects.toMatchObject({ status: 400 })

    const created = await createFederatedCredential(deps, applicationId, {
      name: 'Inline key',
      issuer: 'https://platform.example.com',
      subject: 'org_1:*',
      audienceResourceId,
      publicKeys: [{ kty: 'RSA', kid: 'key-1', alg: 'RS256', n: 'public-modulus', e: 'AQAB' }],
      metadata: { owner: 'platform' },
    })
    expect(created).toMatchObject({
      applicationId,
      name: 'Inline key',
      publicKeys: [{ kty: 'RSA', kid: 'key-1', alg: 'RS256', n: 'public-modulus', e: 'AQAB' }],
      metadata: { owner: 'platform' },
    })
    await expect(getFederatedCredential(deps, applicationId, created.id)).resolves.toMatchObject({
      id: created.id,
      enabled: true,
    })
    await expect(
      updateFederatedCredential(deps, applicationId, created.id, { publicKeys: [], jwksUrl: null }),
    ).rejects.toMatchObject({ status: 400 })

    await expect(
      updateFederatedCredential(deps, applicationId, created.id, {
        enabled: false,
        name: 'Disabled inline key',
        jwksUrl: null,
        publicKeys: [{ kty: 'EC', kid: 'key-2', alg: 'ES256', crv: 'P-256', x: 'public-x', y: 'public-y' }],
      }),
    ).resolves.toMatchObject({
      id: created.id,
      enabled: false,
      name: 'Disabled inline key',
      jwksUrl: null,
      publicKeys: [{ kty: 'EC', kid: 'key-2', alg: 'ES256', crv: 'P-256', x: 'public-x', y: 'public-y' }],
    })
    await expect(
      updateFederatedCredential(deps, applicationId, created.id, {
        name: 'Validated current keys',
        audienceResourceId,
      }),
    ).resolves.toMatchObject({ name: 'Validated current keys' })
    repository.failNextCredentialUpdate()
    await expect(
      updateFederatedCredential(deps, applicationId, created.id, { name: 'Concurrent deletion' }),
    ).rejects.toMatchObject({ status: 404 })

    await expect(deleteFederatedCredential(deps, applicationId, created.id)).resolves.toBeUndefined()
    await expect(getFederatedCredential(deps, applicationId, created.id)).rejects.toMatchObject({ status: 404 })
    await expect(
      updateFederatedCredential(deps, applicationId, 'missing-credential', { enabled: true }),
    ).rejects.toMatchObject({
      status: 404,
    })
    await expect(deleteFederatedCredential(deps, applicationId, 'missing-credential')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('rejects clients without token exchange grants', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture()
    repository.client = { ...repository.client!, grantTypes: null, scopes: null }
    const subjectToken = await signEs256TestJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: defaultAudience,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
    )

    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })
})

interface SeedCredentialInput {
  issuer: string
  subject?: string
  audience?: string
  ownerOrganizationId?: string
  jwksUrl?: string | null
  publicKeys?: Record<string, unknown>[] | null
}

class InMemoryTokenExchangeRepository implements TokenExchangeRepository {
  client: OAuthClientRecord | null = null
  private failUpdate = false
  private credentials: ResolvedFederatedCredential[] = []
  private records = new Map<string, FederatedCredentialRecord>()
  private nextId = 1
  private tokens = new Map<string, TokenExchangeAccessTokenRecord | null>()
  private refreshTokens = new Map<string, TokenExchangeRefreshTokenRecord>()

  async findClient(clientId: string) {
    return this.client?.clientId === clientId ? this.client : null
  }

  async findFederatedCredentials(applicationClientIdValue: string, issuer: string) {
    return this.credentials.filter(
      (item) => item.applicationClientId === applicationClientIdValue && item.issuer === issuer,
    )
  }

  async listFederatedCredentials(applicationIdValue: string) {
    return [...this.records.values()].filter((item) => item.applicationId === applicationIdValue)
  }

  async getFederatedCredential(applicationIdValue: string, id: string) {
    const record = this.records.get(id)
    return record && record.applicationId === applicationIdValue ? record : null
  }

  async createFederatedCredential(applicationIdValue: string, input: CreateFederatedCredentialInput) {
    const now = new Date()
    const id = `fcr_${this.nextId++}`
    const record: FederatedCredentialRecord = {
      id,
      applicationId: applicationIdValue,
      name: input.name,
      issuer: input.issuer,
      subject: input.subject,
      audienceResourceId: input.audienceResourceId,
      jwksUrl: input.jwksUrl ?? null,
      publicKeys: input.publicKeys ?? null,
      enabled: true,
      metadata: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    }
    this.records.set(id, record)
    this.credentials.push({
      id,
      applicationId: applicationIdValue,
      applicationClientId,
      ownerOrganizationId: 'org_1',
      name: input.name,
      issuer: input.issuer,
      subject: input.subject,
      audience: defaultAudience,
      jwksUrl: input.jwksUrl ?? null,
      publicKeys: input.publicKeys ?? null,
      enabled: true,
    })
    return record
  }

  async updateFederatedCredential(applicationIdValue: string, id: string, input: UpdateFederatedCredentialInput) {
    const record = this.records.get(id)
    if (!record || record.applicationId !== applicationIdValue) return null
    if (this.failUpdate) {
      this.failUpdate = false
      return null
    }
    const updated: FederatedCredentialRecord = {
      ...record,
      name: input.name ?? record.name,
      subject: input.subject ?? record.subject,
      audienceResourceId: input.audienceResourceId ?? record.audienceResourceId,
      jwksUrl: input.jwksUrl === undefined ? record.jwksUrl : input.jwksUrl,
      publicKeys: input.publicKeys === undefined ? record.publicKeys : input.publicKeys,
      metadata: input.metadata === undefined ? record.metadata : input.metadata,
      enabled: input.enabled ?? record.enabled,
      updatedAt: new Date(),
    }
    this.records.set(id, updated)
    return updated
  }

  async deleteFederatedCredential(applicationIdValue: string, id: string) {
    const record = this.records.get(id)
    if (!record || record.applicationId !== applicationIdValue) return false
    this.records.delete(id)
    return true
  }

  async seedCredential(input: SeedCredentialInput) {
    const id = `fcr_${this.nextId++}`
    const now = new Date()
    const publicKeys =
      input.publicKeys === undefined
        ? input.jwksUrl
          ? null
          : [{ ...(await defaultSigningJwk()), kid: 'default', alg: 'ES256' }]
        : input.publicKeys
    this.credentials.push({
      id,
      applicationId,
      applicationClientId,
      ownerOrganizationId: input.ownerOrganizationId ?? 'org_1',
      name: 'External Platform',
      issuer: input.issuer,
      subject: input.subject ?? 'org_1:*',
      audience: input.audience ?? defaultAudience,
      jwksUrl: input.jwksUrl ?? null,
      publicKeys,
      enabled: true,
    })
    this.records.set(id, {
      id,
      applicationId,
      name: 'External Platform',
      issuer: input.issuer,
      subject: input.subject ?? 'org_1:*',
      audienceResourceId: 'res_1',
      jwksUrl: input.jwksUrl ?? null,
      publicKeys,
      enabled: true,
      metadata: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  clearCredentials() {
    this.credentials = []
  }

  failNextCredentialUpdate() {
    this.failUpdate = true
  }

  async storeAccessToken(input: Parameters<TokenExchangeRepository['storeAccessToken']>[0]) {
    this.tokens.set(input.tokenHash, { ...input, createdAt: new Date(), revokedAt: null })
  }

  async findAccessTokenByHash(tokenHash: string) {
    return this.tokens.get(tokenHash) ?? null
  }

  async findFederatedCredentialForClient(id: string, clientId: string) {
    return this.credentials.find((item) => item.id === id && item.applicationClientId === clientId) ?? null
  }

  async storeRefreshToken(input: Omit<TokenExchangeRefreshTokenRecord, 'consumedAt' | 'revokedAt' | 'createdAt'>) {
    const revoked = [...this.refreshTokens.values()].some(
      (token) => token.familyId === input.familyId && token.revokedAt,
    )
    this.refreshTokens.set(input.tokenHash, {
      ...input,
      consumedAt: null,
      revokedAt: revoked ? new Date() : null,
      createdAt: new Date(),
    })
    return !revoked
  }

  async findRefreshTokenByHash(tokenHash: string) {
    return this.refreshTokens.get(tokenHash) ?? null
  }

  injectLegacyRefreshClaims(claims: Record<string, unknown>) {
    for (const [hash, token] of this.refreshTokens) {
      this.refreshTokens.set(hash, { ...token, claims: { ...token.claims, ...claims } })
    }
  }

  async consumeRefreshToken(id: string, consumedAt: Date) {
    for (const [hash, token] of this.refreshTokens) {
      if (token.id === id && !token.consumedAt && !token.revokedAt) {
        this.refreshTokens.set(hash, { ...token, consumedAt })
        return true
      }
    }
    return false
  }

  async rotateRefreshToken(input: Parameters<TokenExchangeRepository['rotateRefreshToken']>[0]) {
    const parent = [...this.refreshTokens.entries()].find(([, token]) => token.id === input.refreshToken.parentId)
    if (!parent || parent[1].consumedAt || parent[1].revokedAt) return false
    const now = new Date()
    this.refreshTokens.set(parent[0], { ...parent[1], consumedAt: now })
    this.refreshTokens.set(input.refreshToken.tokenHash, {
      ...input.refreshToken,
      consumedAt: null,
      revokedAt: null,
      createdAt: now,
    })
    this.tokens.set(input.accessToken.tokenHash, {
      ...input.accessToken,
      createdAt: now,
      revokedAt: null,
    })
    return true
  }

  async revokeRefreshTokenFamily(familyId: string, revokedAt: Date) {
    for (const [hash, token] of this.refreshTokens) {
      if (token.familyId === familyId && !token.revokedAt) this.refreshTokens.set(hash, { ...token, revokedAt })
    }
  }

  expireTokens() {
    for (const [tokenHash, token] of this.tokens) {
      if (token) this.tokens.set(tokenHash, { ...token, expiresAt: new Date(Date.now() - 1000) })
    }
  }

  unexpireTokens() {
    for (const [tokenHash, token] of this.tokens) {
      if (token) this.tokens.set(tokenHash, { ...token, expiresAt: new Date(Date.now() + 1000) })
    }
  }

  revokeTokens() {
    for (const [tokenHash, token] of this.tokens) {
      if (token) this.tokens.set(tokenHash, { ...token, revokedAt: new Date() })
    }
  }
}

/** Minimal application/authorization ports so the credential-CRUD usecases validate. */
function credentialDeps(repository: InMemoryTokenExchangeRepository): Deps {
  return {
    ids: createIdentifierGeneratorFake(),
    tokenExchange: repository,
    jwks: createJwksGateway(),
    users: {
      getUser: async (id: string) => ({ id, banned: false }),
    },
    applications: {
      findById: async (id: string) =>
        id === applicationId ? { id: applicationId, ownerOrganizationId: 'org_1' } : null,
      findByClientId: async (clientId: string) =>
        clientId === repository.client?.clientId
          ? {
              id: applicationId,
              clientId,
              ownerOrganizationId: 'org_1',
              visibility: 'private',
              disabled: false,
              oidcScopes: clientScopes(repository).filter((scope) => scope === 'offline_access'),
              resourceScopes: [
                {
                  resourceServerId: audienceResourceId,
                  scopes: clientScopes(repository).filter((scope) => scope !== 'offline_access'),
                },
              ],
              tokenExchangePolicies: [],
            }
          : null,
    },
    authorization: {
      findOrganization: async (id: string) => (id === 'org_1' ? ({ id, disabled: false } as never) : null),
      findResource: async (id: string) => (id === audienceResourceId ? eligibleAudienceResource() : null),
      findResourceByResourceUrl: async (resourceUrl: string) =>
        resourceUrl === defaultAudience ? eligibleAudienceResource(clientScopes(repository)) : null,
      listUserMemberships: async () => [],
      listActiveUserScopeEntitlements: async () => [],
      listActiveApplicationScopeEntitlements: async () => [],
    },
  } as unknown as Deps
}

function eligibleAudienceResource(scopes: string[] = ['runner:connect']) {
  return {
    id: audienceResourceId,
    resourceUrl: defaultAudience,
    enabled: true,
    availableToAgents: true,
    ownerOrganizationId: 'org_1',
    visibility: 'private' as const,
    scopeRegistry: {
      discovery: {
        sourceUrl: 'https://ama.example.com/openapi.json',
        etag: null,
        documentHash: 'test-registry',
        syncedAt: '2026-01-01T00:00:00.000Z',
        lastError: null,
      },
      scopes: scopes
        .filter((scope) => scope !== 'offline_access')
        .map((value) => ({ value, description: null, grantMode: 'automatic' as const })),
    },
  }
}

async function agentResourceDelegationFixture() {
  const { deps, clientSecret } = await tokenExchangeFixture({ scopes: ['identities:write'] })
  const sourceResource = eligibleAudienceResource(['ak:agent:create'])
  const targetResource = {
    ...eligibleAudienceResource(['identities:write']),
    id: 'res_ama',
    resourceUrl: 'https://ama.example.com/api',
    authorizationModel: 'native' as const,
    scopeRegistry: {
      ...eligibleAudienceResource(['identities:write']).scopeRegistry,
      scopes: [{ value: 'identities:write', description: null, grantMode: 'assigned' as const }],
    },
  }
  let policies = [
    {
      sourceResourceServerId: sourceResource.id,
      targetResourceServerId: targetResource.id,
      scopeMappings: [{ sourceScope: 'ak:agent:create', targetScope: 'identities:write' }],
    },
  ]
  const findApplication = deps.applications.findByClientId
  deps.applications.findByClientId = async (clientId) => {
    const application = await findApplication(clientId)
    return application
      ? {
          ...application,
          tokenExchangePolicies: policies,
          resourceScopes: [{ resourceServerId: targetResource.id, scopes: ['identities:write'] }],
        }
      : null
  }
  deps.authorization.findResourceByResourceUrl = async (resourceUrl) =>
    (resourceUrl === sourceResource.resourceUrl
      ? sourceResource
      : resourceUrl === targetResource.resourceUrl
        ? targetResource
        : null) as never
  deps.authorization.listActiveApplicationScopeEntitlements = async () => [{ scope: 'identities:write' }] as never
  deps.authorization.listActiveUserScopeEntitlements = async () =>
    [{ scope: 'identities:write', organizationId: 'org_1' }] as never
  deps.authorization.findOrganization = async () => ({ id: 'org_1', disabled: false }) as never
  deps.authorization.findMemberByOrganizationUser = async () => ({ id: 'member_1' }) as never
  const identity = {
    id: 'agent_identity_1',
    issuer: realmrootIssuer,
    subject: 'agent_1',
    ownerUserId: 'user_1',
    ownerOrganizationId: null,
    status: 'active',
    deletedAt: null as Date | null,
  }
  const aggregate = {
    identity,
    bindings: [{ id: 'binding_1', status: 'active', revokedAt: null as Date | null }],
  }
  deps.agentIdentities = {
    findByIssuerSubject: vi.fn().mockResolvedValue(identity),
    findIdentity: vi.fn().mockResolvedValue(aggregate),
  } as never
  const lease = { id: 'lease_1', requestId: 'request_1', bindingId: 'binding_1' }
  const sourceRequest = {
    id: 'request_1',
    resourceId: sourceResource.id,
    agentIdentityId: identity.id,
  }
  deps.externalResources = {
    findActiveTokenLeaseByTokenHash: vi.fn().mockResolvedValue(lease),
    findAccessRequest: vi.fn().mockResolvedValue(sourceRequest),
  } as never
  deps.agentAudit = { append: vi.fn() } as never
  const input = {
    grantType: tokenExchangeGrantType,
    subjectToken: 'active-agent-resource-token',
    subjectTokenType: accessTokenType,
    audience: targetResource.resourceUrl,
    scope: 'identities:write',
    verifiedSubjectClaims: {
      iss: realmrootIssuer,
      sub: 'user_1',
      aud: sourceResource.resourceUrl,
      jti: 'resat_1',
      client_id: 'realmroot-cli',
      scope: 'ak:agent:create',
      exp: Math.floor(Date.now() / 1000) + 600,
      [realmrootOrganizationClaim]: 'org_1',
      act: { iss: realmrootIssuer, sub: 'agent_1' } as { iss?: string; sub?: string },
    } as Record<string, unknown> & { act: { iss?: string; sub?: string }; client_id: string },
  }
  return {
    deps,
    clientSecret,
    sourceResource,
    targetResource,
    identity,
    aggregate,
    lease,
    sourceRequest,
    input,
    setPolicies: (next: typeof policies) => {
      policies = next
    },
  }
}

async function delegatedAgentResourceFixture() {
  const fixture = await agentResourceDelegationFixture()
  const findExchangeApplication = fixture.deps.applications.findByClientId
  const sourceApplication = {
    id: 'app_previous_hop',
    clientId: 'previous-confidential-client',
    ownerOrganizationId: 'org_1',
    visibility: 'private' as const,
    disabled: false,
    oidcScopes: [],
    resourceScopes: [],
    tokenExchangePolicies: [
      {
        sourceResourceServerId: 'res_before_ak',
        targetResourceServerId: fixture.sourceResource.id,
        scopeMappings: [{ sourceScope: 'previous:agent', targetScope: 'ak:agent:create' }],
      },
    ],
  }
  fixture.deps.applications.findByClientId = async (clientId) =>
    clientId === sourceApplication.clientId ? (sourceApplication as never) : findExchangeApplication(clientId)
  fixture.input.verifiedSubjectClaims.client_id = sourceApplication.clientId

  return { ...fixture, sourceApplication }
}

function clientScopes(repository: InMemoryTokenExchangeRepository) {
  const scopes = repository.client?.scopes
  return typeof scopes === 'string' ? (JSON.parse(scopes) as string[]) : []
}

async function tokenExchangeFixture(
  options: { grantTypes?: string[]; scopes?: string[]; seedCredential?: boolean } = {},
) {
  const repository = new InMemoryTokenExchangeRepository()
  const deps = credentialDeps(repository)
  const clientSecret = 'runner-client-secret'
  repository.client = {
    clientId: applicationClientId,
    clientSecret: await hashProviderSecret(clientSecret),
    disabled: false,
    grantTypes: JSON.stringify(options.grantTypes ?? [tokenExchangeGrantType]),
    scopes: JSON.stringify(options.scopes ?? ['runner:connect']),
  }
  if (options.seedCredential !== false) {
    await repository.seedCredential({ issuer: 'https://platform.example.com' })
  }
  return { repository, deps, clientSecret }
}

async function signEs256TestJwt(payload: Record<string, unknown>, secret: string) {
  const keyPair =
    secret === 'external-platform-secret'
      ? await defaultSigningKeyPair()
      : await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  return signEs256Jwt(payload, keyPair.privateKey, 'default')
}

async function signJwtWithHeader(
  payload: Record<string, unknown>,
  _secret: string,
  headerValue: Record<string, unknown>,
) {
  const header = base64UrlString(JSON.stringify(headerValue))
  const body = base64UrlString(JSON.stringify(payload))
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    (await defaultSigningKeyPair()).privateKey,
    new TextEncoder().encode(`${header}.${body}`),
  )
  return `${header}.${body}.${base64Url(new Uint8Array(signature))}`
}

let signingKeyPairPromise: Promise<CryptoKeyPair> | null = null

function defaultSigningKeyPair() {
  signingKeyPairPromise ??= crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  return signingKeyPairPromise
}

async function defaultSigningJwk() {
  return crypto.subtle.exportKey('jwk', (await defaultSigningKeyPair()).publicKey)
}

async function signRs256Jwt(payload: Record<string, unknown>, privateKey: CryptoKey, kid: string) {
  const header = base64UrlString(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }))
  const body = base64UrlString(JSON.stringify(payload))
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(`${header}.${body}`),
  )
  return `${header}.${body}.${base64Url(new Uint8Array(signature))}`
}

async function signEs256Jwt(payload: Record<string, unknown>, privateKey: CryptoKey, kid: string) {
  const header = base64UrlString(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }))
  const body = base64UrlString(JSON.stringify(payload))
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(`${header}.${body}`),
  )
  return `${header}.${body}.${base64Url(new Uint8Array(signature))}`
}

async function signHs384HeaderJwt(payload: Record<string, unknown>, secret: string, kid: string) {
  const header = base64UrlString(JSON.stringify({ alg: 'HS384', typ: 'JWT', kid }))
  const body = base64UrlString(JSON.stringify(payload))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`))
  return `${header}.${body}.${base64Url(new Uint8Array(signature))}`
}

function base64UrlString(value: string) {
  return base64Url(new TextEncoder().encode(value))
}

function base64Url(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
