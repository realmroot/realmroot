import { hashProviderSecret } from '@server/modules/applications/service-utils'
import {
  accessTokenType,
  jwtTokenType,
  type OAuthClientRecord,
  parseBasicClientAuthorization,
  type TokenExchangeRepository,
  TokenExchangeService,
  tokenExchangeGrantType,
} from '@server/modules/token-exchange/service'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('token exchange service', () => {
  it('exchanges a trusted external JWT assertion for an introspectable access token', async () => {
    const repository = new InMemoryTokenExchangeRepository()
    const service = new TokenExchangeService(repository)
    const clientSecret = 'runner-client-secret'
    repository.client = {
      clientId: 'runner-client',
      clientSecret: await hashProviderSecret(clientSecret),
      disabled: false,
      grantTypes: JSON.stringify([tokenExchangeGrantType]),
      scopes: JSON.stringify(['runner:connect']),
    }
    await service.createTrustedIssuer({
      name: 'External Platform',
      issuer: 'https://platform.example.com',
      sharedSecret: 'external-platform-secret',
      allowedAudiences: ['https://ama.example.com'],
    })

    const subjectToken = await signHs256Jwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: 'https://ama.example.com',
        exp: Math.floor(Date.now() / 1000) + 60,
        ama_project_id: 'project_1',
        ama_environment_id: 'env_1',
        ama_runner_id: 'runner_1',
        runner_capabilities: ['session:poll', 'session:claim'],
      },
      'external-platform-secret',
    )

    const exchanged = await service.exchange(
      {
        grantType: tokenExchangeGrantType,
        subjectToken,
        subjectTokenType: jwtTokenType,
        requestedTokenType: accessTokenType,
        audience: 'https://ama.example.com',
        scope: 'runner:connect',
      },
      { clientId: 'runner-client', clientSecret },
    )

    expect(exchanged).toMatchObject({
      issued_token_type: accessTokenType,
      token_type: 'Bearer',
      scope: 'runner:connect',
    })
    expect(exchanged.access_token).toMatch(/^fatx_/)

    await expect(
      service.introspect(exchanged.access_token, { clientId: 'runner-client', clientSecret }),
    ).resolves.toMatchObject({
      active: true,
      iss: 'https://platform.example.com',
      sub: 'org_1:runner_1',
      aud: 'https://ama.example.com',
      client_id: 'runner-client',
      scope: 'runner:connect',
      ama_project_id: 'project_1',
      ama_environment_id: 'env_1',
      ama_runner_id: 'runner_1',
      runner_capabilities: ['session:poll', 'session:claim'],
    })

    repository.expireTokens()
    await expect(
      service.introspect(exchanged.access_token, { clientId: 'runner-client', clientSecret }),
    ).resolves.toEqual({
      active: false,
    })
    repository.unexpireTokens()
    repository.revokeTokens()
    await expect(
      service.introspect(exchanged.access_token, { clientId: 'runner-client', clientSecret }),
    ).resolves.toEqual({
      active: false,
    })
  })

  it('rejects disallowed audiences and inactive exchanged tokens', async () => {
    const repository = new InMemoryTokenExchangeRepository()
    const service = new TokenExchangeService(repository)
    const clientSecret = 'runner-client-secret'
    repository.client = {
      clientId: 'runner-client',
      clientSecret: await hashProviderSecret(clientSecret),
      disabled: false,
      grantTypes: JSON.stringify([tokenExchangeGrantType]),
      scopes: JSON.stringify(['runner:connect']),
    }
    await service.createTrustedIssuer({
      name: 'External Platform',
      issuer: 'https://platform.example.com',
      sharedSecret: 'external-platform-secret',
      allowedAudiences: ['https://ama.example.com'],
    })
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
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://other.example.com',
          scope: 'runner:connect',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 401 })

    await expect(service.introspect('missing-token', { clientId: 'runner-client', clientSecret })).resolves.toEqual({
      active: false,
    })
  })

  it('exchanges a trusted RS256 JWT assertion from JWKS', async () => {
    const repository = new InMemoryTokenExchangeRepository()
    const service = new TokenExchangeService(repository)
    const clientSecret = 'runner-client-secret'
    repository.client = {
      clientId: 'runner-client',
      clientSecret: await hashProviderSecret(clientSecret),
      disabled: false,
      grantTypes: JSON.stringify([tokenExchangeGrantType]),
      scopes: JSON.stringify(['runner:connect']),
    }
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
    await service.createTrustedIssuer({
      name: 'External Platform',
      issuer: 'https://platform.example.com',
      jwksUrl: 'https://platform.example.com/.well-known/jwks.json',
      allowedAudiences: ['https://ama.example.com'],
    })

    const subjectToken = await signRs256Jwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: ['https://ama.example.com'],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      keyPair.privateKey,
      'ak-key-1',
    )

    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
          scope: 'runner:connect',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).resolves.toMatchObject({
      issued_token_type: accessTokenType,
      token_type: 'Bearer',
    })
  })

  it('exchanges a trusted ES256 JWT assertion from JWKS', async () => {
    const repository = new InMemoryTokenExchangeRepository()
    const service = new TokenExchangeService(repository)
    const clientSecret = 'runner-client-secret'
    repository.client = {
      clientId: 'runner-client',
      clientSecret: await hashProviderSecret(clientSecret),
      disabled: false,
      grantTypes: JSON.stringify([tokenExchangeGrantType]),
      scopes: JSON.stringify(['runner:connect']),
    }
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'ak-key-1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await service.createTrustedIssuer({
      name: 'External Platform',
      issuer: 'https://platform.example.com',
      jwksUrl: 'https://platform.example.com/.well-known/jwks.json',
      allowedAudiences: ['https://ama.example.com'],
    })

    const subjectToken = await signEs256Jwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: 'https://ama.example.com',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      keyPair.privateKey,
      'ak-key-1',
    )

    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
          scope: 'runner:connect',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).resolves.toMatchObject({
      issued_token_type: accessTokenType,
      token_type: 'Bearer',
    })
  })

  it('rejects unsupported JWKS algorithms', async () => {
    const { service, repository, clientSecret } = await tokenExchangeFixture()
    repository.clearIssuer()
    await service.createTrustedIssuer({
      name: 'External Platform',
      issuer: 'https://platform.example.com',
      jwksUrl: 'https://platform.example.com/.well-known/jwks.json',
      allowedAudiences: ['https://ama.example.com'],
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
        aud: 'https://ama.example.com',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
      'ak-key-1',
    )

    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects invalid client and subject token boundaries', async () => {
    const repository = new InMemoryTokenExchangeRepository()
    const service = new TokenExchangeService(repository)
    const clientSecret = 'runner-client-secret'
    repository.client = {
      clientId: 'runner-client',
      clientSecret: await hashProviderSecret(clientSecret),
      disabled: false,
      grantTypes: JSON.stringify([tokenExchangeGrantType]),
      scopes: JSON.stringify(['runner:connect']),
    }

    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken: 'invalid',
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret: null },
      ),
    ).rejects.toMatchObject({ status: 401 })

    await expect(
      service.createTrustedIssuer({
        name: 'No Key',
        issuer: 'https://platform.example.com',
      }),
    ).rejects.toMatchObject({ status: 400 })

    await service.createTrustedIssuer({
      name: 'External Platform',
      issuer: 'https://platform.example.com',
      sharedSecret: 'external-platform-secret',
      allowedAudiences: ['https://ama.example.com'],
    })

    const expiredSubjectToken = await signHs256Jwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: 'https://ama.example.com',
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      'external-platform-secret',
    )
    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken: expiredSubjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
          scope: 'runner:connect',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 401 })

    const futureSubjectToken = await signHs256Jwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: 'https://ama.example.com',
        nbf: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
    )
    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken: futureSubjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
          scope: 'runner:connect',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 401 })

    const validSubjectToken = await signHs256Jwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: 'https://ama.example.com',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
    )
    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken: validSubjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
          scope: 'runner:admin',
        },
        { clientId: 'runner-client', clientSecret },
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
    const { service, repository, clientSecret } = await tokenExchangeFixture()
    const subjectToken = await signHs256Jwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: 'https://ama.example.com',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
    )

    await expect(
      service.exchange(
        {
          grantType: 'client_credentials',
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: accessTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          requestedTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 400 })

    repository.client = { ...repository.client!, disabled: true }
    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 401 })

    repository.client = { ...repository.client!, disabled: false, grantTypes: JSON.stringify(['client_credentials']) }
    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects invalid subject token signer states', async () => {
    const { service, repository, clientSecret } = await tokenExchangeFixture()
    const unsignedSubjectToken = await signHs256Jwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: 'https://ama.example.com',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'wrong-secret',
    )

    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken: unsignedSubjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 401 })

    repository.clearIssuer()
    await service.createTrustedIssuer({
      name: 'External Platform',
      issuer: 'https://platform.example.com',
      jwksUrl: 'https://platform.example.com/.well-known/jwks.json',
      allowedAudiences: ['https://ama.example.com'],
    })
    const hsSubjectToken = await signHs256Jwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: 'https://ama.example.com',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
    )
    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken: hsSubjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 401 })

    const rsHeaderSubjectToken = await signHs256JwtWithHeader(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: 'https://ama.example.com',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
      { alg: 'RS256', typ: 'JWT', kid: 'ak-key-1' },
    )
    repository.clearIssuer()
    await service.createTrustedIssuer({
      name: 'External Platform',
      issuer: 'https://platform.example.com',
      sharedSecret: 'external-platform-secret',
      allowedAudiences: ['https://ama.example.com'],
    })
    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken: rsHeaderSubjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects unavailable or unmatched JWKS signing keys', async () => {
    const { service, repository, clientSecret } = await tokenExchangeFixture()
    repository.clearIssuer()
    await service.createTrustedIssuer({
      name: 'External Platform',
      issuer: 'https://platform.example.com',
      jwksUrl: 'https://platform.example.com/.well-known/jwks.json',
      allowedAudiences: ['https://ama.example.com'],
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
        aud: 'https://ama.example.com',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      keyPair.privateKey,
      'ak-key-1',
    )

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('not found', { status: 404 }))
    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 401 })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ keys: [{ kid: 'other-key', alg: 'RS256' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 401 })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ notKeys: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
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
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('lists trusted issuers and rejects invalid client secrets', async () => {
    const { service } = await tokenExchangeFixture()

    await expect(service.listTrustedIssuers()).resolves.toHaveLength(1)
    await expect(
      service.introspect('missing-token', { clientId: 'runner-client', clientSecret: 'wrong-secret' }),
    ).rejects.toMatchObject({
      status: 401,
    })
  })

  it('rejects clients without token exchange grants', async () => {
    const { service, repository, clientSecret } = await tokenExchangeFixture()
    repository.client = { ...repository.client!, grantTypes: null, scopes: null }
    const subjectToken = await signHs256Jwt(
      {
        iss: 'https://platform.example.com',
        sub: 'org_1:runner_1',
        aud: 'https://ama.example.com',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'external-platform-secret',
    )

    await expect(
      service.exchange(
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: jwtTokenType,
          audience: 'https://ama.example.com',
        },
        { clientId: 'runner-client', clientSecret },
      ),
    ).rejects.toMatchObject({ status: 401 })
  })
})

class InMemoryTokenExchangeRepository implements TokenExchangeRepository {
  client: OAuthClientRecord | null = null
  private issuer: Awaited<ReturnType<TokenExchangeRepository['createTrustedIssuer']>> | null = null
  private tokens = new Map<string, Awaited<ReturnType<TokenExchangeRepository['findAccessTokenByHash']>>>()

  async findClient(clientId: string) {
    return this.client?.clientId === clientId ? this.client : null
  }

  async findTrustedIssuer(issuer: string) {
    return this.issuer?.issuer === issuer ? this.issuer : null
  }

  async createTrustedIssuer(input: Parameters<TokenExchangeRepository['createTrustedIssuer']>[0]) {
    const now = new Date()
    this.issuer = {
      id: 'tei_1',
      issuer: input.issuer,
      name: input.name,
      jwksUrl: input.jwksUrl ?? null,
      sharedSecret: input.sharedSecret ?? null,
      allowedAudiences: input.allowedAudiences ?? null,
      enabled: true,
      metadata: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    }
    return this.issuer
  }

  async listTrustedIssuers() {
    return this.issuer ? [this.issuer] : []
  }

  clearIssuer() {
    this.issuer = null
  }

  async storeAccessToken(input: Parameters<TokenExchangeRepository['storeAccessToken']>[0]) {
    this.tokens.set(input.tokenHash, { ...input, createdAt: new Date(), revokedAt: null })
  }

  async findAccessTokenByHash(tokenHash: string) {
    return this.tokens.get(tokenHash) ?? null
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

async function tokenExchangeFixture() {
  const repository = new InMemoryTokenExchangeRepository()
  const service = new TokenExchangeService(repository)
  const clientSecret = 'runner-client-secret'
  repository.client = {
    clientId: 'runner-client',
    clientSecret: await hashProviderSecret(clientSecret),
    disabled: false,
    grantTypes: JSON.stringify([tokenExchangeGrantType]),
    scopes: JSON.stringify(['runner:connect']),
  }
  await service.createTrustedIssuer({
    name: 'External Platform',
    issuer: 'https://platform.example.com',
    sharedSecret: 'external-platform-secret',
    allowedAudiences: ['https://ama.example.com'],
  })
  return { repository, service, clientSecret }
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
