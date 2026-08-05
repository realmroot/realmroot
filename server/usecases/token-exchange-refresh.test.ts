import { createJwksGateway } from '@server/adapters/gateways/jwks'
import { hashProviderSecret } from '@server/usecases/applications-utils'
import type { Deps } from '@server/usecases/deps'
import type {
  CreateFederatedCredentialInput,
  FederatedCredentialRecord,
  OAuthClientRecord,
  ResolvedFederatedCredential,
  TokenExchangeAccessTokenRecord,
  TokenExchangeRefreshTokenRecord,
  TokenExchangeRepository,
} from '@server/usecases/ports'
import {
  exchangeToken,
  jwtTokenType,
  refreshTokenGrantType,
  refreshToken as refreshTokenVerified,
  tokenExchangeGrantType,
} from '@server/usecases/token-exchange'
import { describe, expect, it } from 'vitest'

const applicationClientId = 'runner-client'
const defaultAudience = 'https://ama.example.com'
const testClient = { clientId: applicationClientId, clientSecret: 'runner-client-secret' }

function refreshToken(deps: Deps, input: Parameters<typeof refreshTokenVerified>[1], client = testClient) {
  return refreshTokenVerified(deps, input, client)
}

describe('token exchange refresh and assertion boundaries', () => {
  it('rejects offline_access scopes when the client cannot issue refresh tokens', async () => {
    const { deps, clientSecret } = await fixture({
      grantTypes: [tokenExchangeGrantType],
      scopes: ['runner:connect', 'offline_access'],
    })
    const subjectToken = await signEs256TestJwt(validClaims(), 'external-platform-secret')

    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
          scope: 'runner:connect offline_access',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects exchanges when the federated credential is disabled', async () => {
    const { deps, clientSecret, repository } = await fixture()
    repository.disableCredentials()
    const subjectToken = await signEs256TestJwt(validClaims(), 'external-platform-secret')

    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects subject tokens missing issuer or subject claims', async () => {
    const { deps, clientSecret } = await fixture()
    const subjectToken = await signEs256TestJwt(
      { aud: 'https://ama.example.com', exp: Math.floor(Date.now() / 1000) + 60 },
      'external-platform-secret',
    )

    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects subject tokens whose audience claim does not match the requested audience', async () => {
    const { deps, clientSecret } = await fixture()
    const subjectToken = await signEs256TestJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: 'https://wrong.example.com',
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
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects subject tokens that are not well-formed JWTs', async () => {
    const { deps, clientSecret } = await fixture()
    const twoSegments = `${base64UrlString('{}')}.${base64UrlString('{}')}`
    const nonObjectPayload = `${base64UrlString('{}')}.${base64UrlString('"not-an-object"')}.sig`

    for (const subjectToken of [twoSegments, nonObjectPayload, '%%%.e30.signature']) {
      await expect(
        exchangeToken(
          deps,
          {
            grantType: tokenExchangeGrantType,
            subjectToken,
            subjectTokenType: jwtTokenType,
            audience: 'https://ama.example.com',
          },
          { clientId: 'runner-client', clientSecret },
        ),
      ).rejects.toMatchObject({ status: 400 })
    }
  })

  it('refreshes without a requested scope and reuses the stored scopes', async () => {
    const { deps, clientSecret, repository } = await fixture({
      grantTypes: [tokenExchangeGrantType, refreshTokenGrantType],
      scopes: ['runner:connect', 'offline_access'],
    })
    const exchanged = await exchangeToken(
      deps,
      {
        grantType: tokenExchangeGrantType,
        subjectToken: await signEs256TestJwt(validClaims(), 'external-platform-secret'),
        subjectTokenType: jwtTokenType,
        audience: 'https://ama.example.com',
        scope: 'runner:connect offline_access',
      },
      { clientId: 'runner-client', clientSecret },
    )

    const refreshed = await refreshToken(deps, {
      grantType: refreshTokenGrantType,
      refreshToken: exchanged.refresh_token!,
    })

    expect(refreshed.scope).toBe('runner:connect offline_access')
    expect(repository.storedTokens()).toBe(2)
  })

  it('binds refresh to client authentication, stored scopes, and an enabled federated credential', async () => {
    const { deps, clientSecret, repository } = await fixture({
      grantTypes: [tokenExchangeGrantType, refreshTokenGrantType],
      scopes: ['runner:connect', 'offline_access'],
    })
    const exchanged = await exchangeToken(
      deps,
      {
        grantType: tokenExchangeGrantType,
        subjectToken: await signEs256TestJwt(validClaims(), 'external-platform-secret'),
        subjectTokenType: jwtTokenType,
        audience: defaultAudience,
        scope: 'runner:connect offline_access',
      },
      { clientId: applicationClientId, clientSecret },
    )
    const input = { grantType: refreshTokenGrantType, refreshToken: exchanged.refresh_token! }

    await expect(refreshToken(deps, input, { ...testClient, clientSecret: 'wrong-secret' })).rejects.toMatchObject({
      status: 401,
      error: 'invalid_client',
    })
    await expect(refreshToken(deps, { ...input, scope: 'runner:admin' })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_scope',
    })
    repository.disableCredentials()
    await expect(refreshToken(deps, input)).rejects.toMatchObject({
      status: 400,
      error: 'invalid_grant',
    })
  })

  it('revokes refresh when audience eligibility or Application tenant changes', async () => {
    const issue = async () => {
      const fixtureValue = await fixture({
        grantTypes: [tokenExchangeGrantType, refreshTokenGrantType],
        scopes: ['runner:connect', 'offline_access'],
      })
      const exchanged = await exchangeToken(
        fixtureValue.deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken: await signEs256TestJwt(validClaims(), 'external-platform-secret'),
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
          scope: 'runner:connect offline_access',
        },
        { clientId: applicationClientId, clientSecret: fixtureValue.clientSecret },
      )
      return { ...fixtureValue, refreshToken: exchanged.refresh_token! }
    }

    const ineligible = await issue()
    ineligible.deps.authorization.findResourceByResourceUrl = async () => null
    await expect(
      refreshToken(ineligible.deps, {
        grantType: refreshTokenGrantType,
        refreshToken: ineligible.refreshToken,
      }),
    ).rejects.toMatchObject({ status: 400, error: 'invalid_grant' })
    expect(ineligible.repository.storedTokens()).toBe(1)

    const transferred = await issue()
    transferred.repository.transferCredential('org_2')
    transferred.deps.authorization.findResourceByResourceUrl = async () =>
      ({
        enabled: true,
        archivedAt: null,
        ownerOrganizationId: 'org_2',
        accessEligibility: { mode: 'owner_organization', organizationIds: [] },
      }) as never
    await expect(
      refreshToken(transferred.deps, {
        grantType: refreshTokenGrantType,
        refreshToken: transferred.refreshToken,
      }),
    ).rejects.toMatchObject({ status: 400, error: 'invalid_grant' })
    expect(transferred.repository.storedTokens()).toBe(1)
  })

  it('rejects refresh requests with the wrong grant type', async () => {
    const { deps } = await fixture()
    await expect(
      refreshToken(deps, { grantType: tokenExchangeGrantType, refreshToken: 'fatr_x.y' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects refresh tokens for clients that lack the refresh grant', async () => {
    const { deps, clientSecret, repository } = await fixture({
      grantTypes: [tokenExchangeGrantType, refreshTokenGrantType],
      scopes: ['runner:connect', 'offline_access'],
    })
    const exchanged = await exchangeToken(
      deps,
      {
        grantType: tokenExchangeGrantType,
        subjectToken: await signEs256TestJwt(validClaims(), 'external-platform-secret'),
        subjectTokenType: jwtTokenType,
        audience: 'https://ama.example.com',
        scope: 'runner:connect offline_access',
      },
      { clientId: 'runner-client', clientSecret },
    )

    repository.client = { ...repository.client!, grantTypes: JSON.stringify([tokenExchangeGrantType]) }
    await expect(
      refreshToken(deps, { grantType: refreshTokenGrantType, refreshToken: exchanged.refresh_token! }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects refresh tokens for unknown or disabled clients', async () => {
    const { deps, clientSecret, repository } = await fixture({
      grantTypes: [tokenExchangeGrantType, refreshTokenGrantType],
      scopes: ['runner:connect', 'offline_access'],
    })
    const exchanged = await exchangeToken(
      deps,
      {
        grantType: tokenExchangeGrantType,
        subjectToken: await signEs256TestJwt(validClaims(), 'external-platform-secret'),
        subjectTokenType: jwtTokenType,
        audience: 'https://ama.example.com',
        scope: 'runner:connect offline_access',
      },
      { clientId: 'runner-client', clientSecret },
    )

    repository.client = { ...repository.client!, disabled: true }
    await expect(
      refreshToken(deps, { grantType: refreshTokenGrantType, refreshToken: exchanged.refresh_token! }),
    ).rejects.toMatchObject({ status: 401, error: 'invalid_client' })
  })

  it('rotates refresh tokens and revokes the family when an ancestor is replayed [spec: agent-identity/workload-refresh-security]', async () => {
    const { deps, clientSecret } = await fixture({
      grantTypes: [tokenExchangeGrantType, refreshTokenGrantType],
      scopes: ['runner:connect', 'offline_access'],
    })
    const exchanged = await exchangeToken(
      deps,
      {
        grantType: tokenExchangeGrantType,
        subjectToken: await signEs256TestJwt(validClaims(), 'external-platform-secret'),
        subjectTokenType: jwtTokenType,
        audience: 'https://ama.example.com',
        scope: 'runner:connect offline_access',
      },
      { clientId: 'runner-client', clientSecret },
    )
    const ancestor = exchanged.refresh_token!
    const rotated = await refreshToken(deps, { grantType: refreshTokenGrantType, refreshToken: ancestor })
    await expect(
      refreshToken(deps, { grantType: refreshTokenGrantType, refreshToken: ancestor }),
    ).rejects.toMatchObject({ status: 400, error: 'invalid_grant' })
    await expect(
      refreshToken(deps, { grantType: refreshTokenGrantType, refreshToken: rotated.refresh_token! }),
    ).rejects.toMatchObject({ status: 400, error: 'invalid_grant' })

    for (const token of ['missing-token', 'fatr_unknown']) {
      await expect(refreshToken(deps, { grantType: refreshTokenGrantType, refreshToken: token })).rejects.toMatchObject(
        { status: 400, error: 'invalid_grant' },
      )
    }
  })

  it('does not persist a refreshed access token when replay revokes the family during rotation', async () => {
    const { deps, clientSecret, repository } = await fixture({
      grantTypes: [tokenExchangeGrantType, refreshTokenGrantType],
      scopes: ['runner:connect', 'offline_access'],
    })
    const exchanged = await exchangeToken(
      deps,
      {
        grantType: tokenExchangeGrantType,
        subjectToken: await signEs256TestJwt(validClaims(), 'external-platform-secret'),
        subjectTokenType: jwtTokenType,
        audience: defaultAudience,
        scope: 'runner:connect offline_access',
      },
      { clientId: applicationClientId, clientSecret },
    )
    repository.revokeFamilyDuringNextRotation()

    await expect(
      refreshToken(deps, {
        grantType: refreshTokenGrantType,
        refreshToken: exchanged.refresh_token!,
      }),
    ).rejects.toMatchObject({ status: 400, error: 'invalid_grant' })
    expect(repository.storedTokens()).toBe(1)
  })

  it('revokes the refresh family when another request consumes the token first', async () => {
    const { deps, clientSecret, repository } = await fixture({
      grantTypes: [tokenExchangeGrantType, refreshTokenGrantType],
      scopes: ['runner:connect', 'offline_access'],
    })
    const exchanged = await exchangeToken(
      deps,
      {
        grantType: tokenExchangeGrantType,
        subjectToken: await signEs256TestJwt(validClaims(), 'external-platform-secret'),
        subjectTokenType: jwtTokenType,
        audience: defaultAudience,
        scope: 'runner:connect offline_access',
      },
      { clientId: applicationClientId, clientSecret },
    )
    repository.rejectNextConsume()

    await expect(
      refreshToken(deps, {
        grantType: refreshTokenGrantType,
        refreshToken: exchanged.refresh_token!,
      }),
    ).rejects.toMatchObject({ status: 400, error: 'invalid_grant' })
  })

  it('rejects subject tokens that declare the "none" algorithm', async () => {
    const { deps, clientSecret } = await fixture()
    const header = base64UrlString(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    const body = base64UrlString(JSON.stringify(validClaims()))
    const subjectToken = `${header}.${body}.`

    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects an assertion whose expiry is missing or non-numeric', async () => {
    const { deps, clientSecret } = await fixture()
    const subjectToken = await signEs256TestJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: 'https://ama.example.com',
        exp: 'not-a-number',
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
          audience: 'https://ama.example.com',
          scope: 'runner:connect',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects an assertion that has already expired', async () => {
    const { deps, clientSecret } = await fixture()
    const subjectToken = await signEs256TestJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: 'https://ama.example.com',
        exp: Math.floor(Date.now() / 1000) - 10,
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
          audience: 'https://ama.example.com',
          scope: 'runner:connect',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects an assertion that is not active yet', async () => {
    const { deps, clientSecret } = await fixture()
    const subjectToken = await signEs256TestJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: 'https://ama.example.com',
        exp: Math.floor(Date.now() / 1000) + 60,
        nbf: Math.floor(Date.now() / 1000) + 30,
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
          audience: 'https://ama.example.com',
          scope: 'runner:connect',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects a non-numeric not-before claim', async () => {
    const { deps, clientSecret } = await fixture()
    const subjectToken = await signEs256TestJwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: 'https://ama.example.com',
        exp: Math.floor(Date.now() / 1000) + 60,
        nbf: 'not-a-number',
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
          audience: 'https://ama.example.com',
          scope: 'runner:connect',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400, error: 'invalid_grant' })
  })

  it('treats malformed client grant metadata as an empty grant list', async () => {
    const { deps, clientSecret, repository } = await fixture()
    repository.client = { ...repository.client!, grantTypes: JSON.stringify('not-an-array') }
    const subjectToken = await signEs256TestJwt(validClaims(), 'external-platform-secret')

    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })
})

function validClaims() {
  return {
    iss: 'https://platform.example.com',
    sub: 'org_1:runner_1',
    aud: 'https://ama.example.com',
    exp: Math.floor(Date.now() / 1000) + 60,
  }
}

async function fixture(options: { grantTypes?: string[]; scopes?: string[] } = {}) {
  const repository = new InMemoryRepository()
  const deps = {
    tokenExchange: repository,
    jwks: createJwksGateway(),
    authorization: {
      findResourceByResourceUrl: async (resourceUrl: string) =>
        resourceUrl === defaultAudience
          ? {
              enabled: true,
              archivedAt: null,
              ownerOrganizationId: 'org_1',
              accessEligibility: { mode: 'owner_organization', organizationIds: [] },
            }
          : null,
    },
  } as unknown as Deps
  const clientSecret = 'runner-client-secret'
  repository.client = {
    clientId: applicationClientId,
    clientSecret: await hashProviderSecret(clientSecret),
    disabled: false,
    grantTypes: JSON.stringify(options.grantTypes ?? [tokenExchangeGrantType]),
    scopes: JSON.stringify(options.scopes ?? ['runner:connect']),
  }
  await repository.seedCredential('https://platform.example.com')
  return { repository, deps, clientSecret }
}

class InMemoryRepository implements TokenExchangeRepository {
  client: OAuthClientRecord | null = null
  private rejectConsume = false
  private revokeNextRefreshFamily = false
  private credentials: ResolvedFederatedCredential[] = []
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

  async listFederatedCredentials(): Promise<FederatedCredentialRecord[]> {
    return []
  }

  async getFederatedCredential(): Promise<FederatedCredentialRecord | null> {
    return null
  }

  async createFederatedCredential(
    _applicationId: string,
    _input: CreateFederatedCredentialInput,
  ): Promise<FederatedCredentialRecord> {
    throw new Error('not implemented')
  }

  async updateFederatedCredential(): Promise<FederatedCredentialRecord | null> {
    return null
  }

  async deleteFederatedCredential() {
    return false
  }

  async seedCredential(issuer: string) {
    this.credentials.push({
      id: `fcr_${this.nextId++}`,
      applicationId: 'app_1',
      applicationClientId,
      ownerOrganizationId: 'org_1',
      name: 'External Platform',
      issuer,
      subject: 'org_1:*',
      audience: defaultAudience,
      jwksUrl: null,
      publicKeys: [{ ...(await defaultSigningJwk()), kid: 'default', alg: 'ES256' }],
      enabled: true,
    })
  }

  disableCredentials() {
    this.credentials = this.credentials.map((item) => ({ ...item, enabled: false }))
  }

  transferCredential(ownerOrganizationId: string) {
    this.credentials = this.credentials.map((item) => ({ ...item, ownerOrganizationId }))
  }

  revokeFamilyDuringNextRotation() {
    this.revokeNextRefreshFamily = true
  }

  rejectNextConsume() {
    this.rejectConsume = true
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

  async storeRefreshToken(input: Omit<TokenExchangeRefreshTokenRecord, 'createdAt' | 'consumedAt' | 'revokedAt'>) {
    if (this.revokeNextRefreshFamily) {
      this.revokeNextRefreshFamily = false
      await this.revokeRefreshTokenFamily(input.familyId, new Date())
    }
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

  async consumeRefreshToken(id: string, consumedAt: Date) {
    if (this.rejectConsume) {
      this.rejectConsume = false
      return false
    }
    for (const [hash, token] of this.refreshTokens) {
      if (token.id === id && !token.consumedAt && !token.revokedAt) {
        this.refreshTokens.set(hash, { ...token, consumedAt })
        return true
      }
    }
    return false
  }

  async revokeRefreshTokenFamily(familyId: string, revokedAt: Date) {
    for (const [hash, token] of this.refreshTokens) {
      if (token.familyId === familyId && !token.revokedAt) this.refreshTokens.set(hash, { ...token, revokedAt })
    }
  }

  storedTokens() {
    return this.tokens.size
  }
}

async function signEs256TestJwt(payload: Record<string, unknown>, _secret: string) {
  const header = base64UrlString(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'default' }))
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

function base64UrlString(value: string) {
  return base64Url(new TextEncoder().encode(value))
}

function base64Url(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
