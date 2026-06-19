import { createJwksGateway } from '@server/adapters/gateways/jwks'
import { hashProviderSecret } from '@server/usecases/applications-utils'
import type { Deps } from '@server/usecases/deps'
import type {
  CreateFederatedCredentialInput,
  FederatedCredentialRecord,
  OAuthAccessTokenRecord,
  OAuthClientRecord,
  ResolvedFederatedCredential,
  TokenExchangeAccessTokenRecord,
  TokenExchangeRepository,
  UpdateFederatedCredentialInput,
} from '@server/usecases/ports'
import {
  accessTokenType,
  createFederatedCredential,
  exchangeToken,
  introspectToken,
  jwtTokenType,
  listFederatedCredentials,
  parseBasicClientAuthorization,
  refreshToken,
  refreshTokenGrantType,
  tokenExchangeGrantType,
} from '@server/usecases/token-exchange'
import { afterEach, describe, expect, it, vi } from 'vitest'

const applicationId = 'app_1'
const applicationClientId = 'runner-client'
const audienceResourceId = 'res_1'
const defaultAudience = 'https://ama.example.com'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('token exchange service', () => {
  it('exchanges a trusted external JWT assertion for an introspectable access token', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture()

    const subjectToken = await signHs256Jwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: defaultAudience,
        exp: Math.floor(Date.now() / 1000) + 60,
        ama_project_id: 'project_1',
        ama_environment_id: 'env_1',
        ama_runner_id: 'runner_1',
        runner_capabilities: ['session:poll', 'session:claim'],
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
    expect(exchanged.access_token).toMatch(/^fatx_/)

    await expect(
      introspectToken(deps, exchanged.access_token, { clientId: applicationClientId, clientSecret }),
    ).resolves.toMatchObject({
      active: true,
      iss: 'https://platform.example.com',
      sub: 'org_1:runner_1',
      aud: defaultAudience,
      client_id: applicationClientId,
      scope: 'runner:connect',
      ama_project_id: 'project_1',
      ama_environment_id: 'env_1',
      ama_runner_id: 'runner_1',
      runner_capabilities: ['session:poll', 'session:claim'],
    })

    repository.expireTokens()
    await expect(
      introspectToken(deps, exchanged.access_token, { clientId: applicationClientId, clientSecret }),
    ).resolves.toEqual({
      active: false,
    })
    repository.unexpireTokens()
    repository.revokeTokens()
    await expect(
      introspectToken(deps, exchanged.access_token, { clientId: applicationClientId, clientSecret }),
    ).resolves.toEqual({
      active: false,
    })
  })

  it('refreshes token-exchange access tokens with a signed refresh token', async () => {
    const { deps, clientSecret } = await tokenExchangeFixture({
      grantTypes: [tokenExchangeGrantType, refreshTokenGrantType],
      scopes: ['runner:connect', 'offline_access'],
    })

    const subjectToken = await signHs256Jwt(
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
    const refreshed = await refreshToken(deps, {
      grantType: refreshTokenGrantType,
      refreshToken: exchanged.refresh_token!,
      scope: 'runner:connect',
    })

    expect(refreshed).toMatchObject({
      issued_token_type: accessTokenType,
      token_type: 'Bearer',
      scope: 'runner:connect',
    })
    expect(refreshed.access_token).toMatch(/^fatx_/)
    await expect(
      introspectToken(deps, refreshed.access_token, { clientId: applicationClientId, clientSecret }),
    ).resolves.toMatchObject({
      active: true,
      iss: 'https://platform.example.com',
      sub: 'org_1:runner_1',
      aud: defaultAudience,
      client_id: applicationClientId,
      scope: 'runner:connect',
      ama_project_id: 'project_1',
      ama_environment_id: 'env_1',
    })
  })

  it('rejects disallowed audiences and inactive exchanged tokens', async () => {
    const { deps, clientSecret } = await tokenExchangeFixture()
    const subjectToken = await signHs256Jwt(
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
    ).rejects.toMatchObject({ status: 401 })

    await expect(
      introspectToken(deps, 'missing-token', { clientId: applicationClientId, clientSecret }),
    ).resolves.toEqual({
      active: false,
    })
  })

  it('introspects a provider-issued opaque token belonging to another client (resource-server introspection)', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture()
    const rawToken = 'runner-device-access-token'
    const now = new Date()
    repository.seedOAuthAccessToken(await hashProviderSecret(rawToken), {
      clientId: 'client_runner',
      userId: 'user_runner',
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
    })

    // The introspecting client (applicationClientId) differs from the token's
    // client (client_runner) — Better Auth's own introspect would report inactive;
    // ours reports active with the token's real client_id.
    await expect(
      introspectToken(deps, rawToken, { clientId: applicationClientId, clientSecret }),
    ).resolves.toMatchObject({
      active: true,
      sub: 'user_runner',
      client_id: 'client_runner',
      scope: 'openid profile email offline_access',
      token_type: 'Bearer',
    })
  })

  it('reports a provider-issued opaque token inactive once it expires', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture()
    const rawToken = 'expired-runner-token'
    const now = new Date()
    repository.seedOAuthAccessToken(await hashProviderSecret(rawToken), {
      clientId: 'client_runner',
      userId: 'user_runner',
      scopes: ['openid'],
      expiresAt: new Date(now.getTime() - 1_000),
      createdAt: new Date(now.getTime() - 60_000),
    })

    await expect(introspectToken(deps, rawToken, { clientId: applicationClientId, clientSecret })).resolves.toEqual({
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
    repository.seedCredential({
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
    repository.seedCredential({
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
    repository.seedCredential({
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
    ).rejects.toMatchObject({ status: 401 })
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
    ).rejects.toMatchObject({ status: 401 })

    await expect(
      createFederatedCredential(deps, applicationId, {
        name: 'No Key',
        issuer: 'https://platform.example.com',
        subject: 'org_1:*',
        audienceResourceId,
      }),
    ).rejects.toMatchObject({ status: 400 })

    repository.seedCredential({ issuer: 'https://platform.example.com' })

    const expiredSubjectToken = await signHs256Jwt(
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
    ).rejects.toMatchObject({ status: 401 })

    const futureSubjectToken = await signHs256Jwt(
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
    ).rejects.toMatchObject({ status: 401 })

    const validSubjectToken = await signHs256Jwt(
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
  })

  it('rejects unsupported exchange inputs and untrusted client states', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture()
    const subjectToken = await signHs256Jwt(
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
    ).rejects.toMatchObject({ status: 401 })

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
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects invalid subject token signer states', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture()
    const unsignedSubjectToken = await signHs256Jwt(
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
    ).rejects.toMatchObject({ status: 401 })

    repository.clearCredentials()
    repository.seedCredential({
      issuer: 'https://platform.example.com',
      jwksUrl: 'https://platform.example.com/.well-known/jwks.json',
    })
    const hsSubjectToken = await signHs256Jwt(
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
          subjectToken: hsSubjectToken,
          subjectTokenType: jwtTokenType,
          audience: defaultAudience,
        },
        { clientId: applicationClientId, clientSecret },
      ),
    ).rejects.toMatchObject({ status: 401 })

    const rsHeaderSubjectToken = await signHs256JwtWithHeader(
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
    repository.seedCredential({ issuer: 'https://platform.example.com' })
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
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects unavailable or unmatched JWKS signing keys', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture({ seedCredential: false })
    repository.seedCredential({
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
    ).rejects.toMatchObject({ status: 401 })

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
    ).rejects.toMatchObject({ status: 401 })

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
    ).rejects.toMatchObject({ status: 401 })

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
    ).rejects.toMatchObject({ status: 401 })
  })

  it('lists federated credentials and rejects invalid client secrets', async () => {
    const { deps } = await tokenExchangeFixture()

    await expect(listFederatedCredentials(deps, applicationId)).resolves.toHaveLength(1)
    await expect(
      introspectToken(deps, 'missing-token', { clientId: applicationClientId, clientSecret: 'wrong-secret' }),
    ).rejects.toMatchObject({
      status: 401,
    })
  })

  it('rejects clients without token exchange grants', async () => {
    const { deps, repository, clientSecret } = await tokenExchangeFixture()
    repository.client = { ...repository.client!, grantTypes: null, scopes: null }
    const subjectToken = await signHs256Jwt(
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
    ).rejects.toMatchObject({ status: 401 })
  })
})

interface SeedCredentialInput {
  issuer: string
  subject?: string
  audience?: string
  sharedSecret?: string | null
  jwksUrl?: string | null
  publicKeys?: Record<string, unknown>[] | null
}

/**
 * In-memory repository over the federated-credential contract. Resolved
 * credentials carry the legacy shared secret (kept off the management surface)
 * so the HS256 verify path stays exercisable without a real keypair.
 */
class InMemoryTokenExchangeRepository implements TokenExchangeRepository {
  client: OAuthClientRecord | null = null
  private credentials: ResolvedFederatedCredential[] = []
  private records = new Map<string, FederatedCredentialRecord>()
  private nextId = 1
  private tokens = new Map<string, TokenExchangeAccessTokenRecord | null>()
  private oauthTokens = new Map<string, OAuthAccessTokenRecord>()

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
      name: input.name,
      issuer: input.issuer,
      subject: input.subject,
      audience: defaultAudience,
      jwksUrl: input.jwksUrl ?? null,
      publicKeys: input.publicKeys ?? null,
      sharedSecret: null,
      enabled: true,
    })
    return record
  }

  async updateFederatedCredential(applicationIdValue: string, id: string, input: UpdateFederatedCredentialInput) {
    const record = this.records.get(id)
    if (!record || record.applicationId !== applicationIdValue) return null
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

  /** Seeds a resolved credential directly (bypassing the no-shared-secret create API). */
  seedCredential(input: SeedCredentialInput) {
    const id = `fcr_${this.nextId++}`
    const now = new Date()
    this.credentials.push({
      id,
      applicationId,
      applicationClientId,
      name: 'External Platform',
      issuer: input.issuer,
      subject: input.subject ?? 'org_1:*',
      audience: input.audience ?? defaultAudience,
      jwksUrl: input.jwksUrl ?? null,
      publicKeys: input.publicKeys ?? null,
      sharedSecret:
        input.sharedSecret === undefined ? (input.jwksUrl ? null : 'external-platform-secret') : input.sharedSecret,
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
      publicKeys: input.publicKeys ?? null,
      enabled: true,
      metadata: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  clearCredentials() {
    this.credentials = []
  }

  async storeAccessToken(input: Parameters<TokenExchangeRepository['storeAccessToken']>[0]) {
    this.tokens.set(input.tokenHash, { ...input, createdAt: new Date(), revokedAt: null })
  }

  async findAccessTokenByHash(tokenHash: string) {
    return this.tokens.get(tokenHash) ?? null
  }

  seedOAuthAccessToken(tokenHash: string, record: OAuthAccessTokenRecord) {
    this.oauthTokens.set(tokenHash, record)
  }

  async findOAuthAccessTokenByHash(tokenHash: string) {
    return this.oauthTokens.get(tokenHash) ?? null
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
    tokenExchange: repository,
    jwks: createJwksGateway(),
    applications: {
      findById: async (id: string) => (id === applicationId ? { id: applicationId } : null),
    },
    authorization: {
      findResource: async (id: string) =>
        id === audienceResourceId ? { id: audienceResourceId, audience: defaultAudience, enabled: true } : null,
    },
  } as unknown as Deps
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
    repository.seedCredential({ issuer: 'https://platform.example.com' })
  }
  return { repository, deps, clientSecret }
}

async function signHs256Jwt(payload: Record<string, unknown>, secret: string) {
  return signHs256JwtWithHeader(payload, secret, { alg: 'HS256', typ: 'JWT' })
}

async function signHs256JwtWithHeader(
  payload: Record<string, unknown>,
  secret: string,
  headerValue: Record<string, unknown>,
) {
  const header = base64UrlString(JSON.stringify(headerValue))
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
