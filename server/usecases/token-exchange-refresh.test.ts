import { createJwksGateway } from '@server/adapters/gateways/jwks'
import { hashProviderSecret } from '@server/usecases/applications-utils'
import type { Deps } from '@server/usecases/deps'
import type { OAuthClientRecord, TokenExchangeRepository } from '@server/usecases/ports'
import {
  accessTokenType,
  createTrustedIssuer,
  exchangeToken,
  jwtTokenType,
  refreshToken,
  refreshTokenGrantType,
  tokenExchangeGrantType,
} from '@server/usecases/token-exchange'
import { describe, expect, it } from 'vitest'

describe('token exchange refresh and assertion boundaries', () => {
  it('rejects offline_access scopes when the client cannot issue refresh tokens', async () => {
    const { deps, clientSecret } = await fixture({
      grantTypes: [tokenExchangeGrantType],
      scopes: ['runner:connect', 'offline_access'],
    })
    const subjectToken = await signHs256Jwt(validClaims(), 'external-platform-secret')

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

  it('rejects exchanges when the trusted issuer is disabled', async () => {
    const { deps, clientSecret, repository } = await fixture()
    repository.disableIssuer()
    const subjectToken = await signHs256Jwt(validClaims(), 'external-platform-secret')

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
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects subject tokens missing issuer or subject claims', async () => {
    const { deps, clientSecret } = await fixture()
    const subjectToken = await signHs256Jwt(
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
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects subject tokens whose audience claim does not match the requested audience', async () => {
    const { deps, clientSecret } = await fixture({ allowedAudiences: null })
    const subjectToken = await signHs256Jwt(
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
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects subject tokens that are not well-formed JWTs', async () => {
    const { deps, clientSecret } = await fixture()
    const twoSegments = `${base64UrlString('{}')}.${base64UrlString('{}')}`
    const nonObjectPayload = `${base64UrlString('{}')}.${base64UrlString('"not-an-object"')}.sig`

    for (const subjectToken of [twoSegments, nonObjectPayload]) {
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
      ).rejects.toMatchObject({ status: 401 })
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
        subjectToken: await signHs256Jwt(validClaims(), 'external-platform-secret'),
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
        subjectToken: await signHs256Jwt(validClaims(), 'external-platform-secret'),
        subjectTokenType: jwtTokenType,
        audience: 'https://ama.example.com',
        scope: 'runner:connect offline_access',
      },
      { clientId: 'runner-client', clientSecret },
    )

    repository.client = { ...repository.client!, grantTypes: JSON.stringify([tokenExchangeGrantType]) }
    await expect(
      refreshToken(deps, { grantType: refreshTokenGrantType, refreshToken: exchanged.refresh_token! }),
    ).rejects.toMatchObject({ status: 401 })
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
        subjectToken: await signHs256Jwt(validClaims(), 'external-platform-secret'),
        subjectTokenType: jwtTokenType,
        audience: 'https://ama.example.com',
        scope: 'runner:connect offline_access',
      },
      { clientId: 'runner-client', clientSecret },
    )

    repository.client = { ...repository.client!, disabled: true }
    await expect(
      refreshToken(deps, { grantType: refreshTokenGrantType, refreshToken: exchanged.refresh_token! }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects malformed and tampered refresh tokens', async () => {
    const { deps, clientSecret, repository } = await fixture({
      grantTypes: [tokenExchangeGrantType, refreshTokenGrantType],
      scopes: ['runner:connect', 'offline_access'],
    })
    const exchanged = await exchangeToken(
      deps,
      {
        grantType: tokenExchangeGrantType,
        subjectToken: await signHs256Jwt(validClaims(), 'external-platform-secret'),
        subjectTokenType: jwtTokenType,
        audience: 'https://ama.example.com',
        scope: 'runner:connect offline_access',
      },
      { clientId: 'runner-client', clientSecret },
    )
    const valid = exchanged.refresh_token!
    const [payloadPart, signaturePart] = valid.slice('fatr_'.length).split('.')

    const badPrefix = valid.slice('fatr_'.length)
    const badParts = `fatr_${payloadPart}`
    const tamperedSignature = `fatr_${payloadPart}.${signaturePart}AA`
    const wrongLengthSignature = `fatr_${payloadPart}.${base64UrlString('short')}`
    const nonRecordPayload = `fatr_${base64UrlString('"plain"')}.${signaturePart}`

    for (const token of [badPrefix, badParts, tamperedSignature, wrongLengthSignature, nonRecordPayload]) {
      await expect(refreshToken(deps, { grantType: refreshTokenGrantType, refreshToken: token })).rejects.toMatchObject(
        { status: 401 },
      )
    }

    const decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart))) as Record<string, unknown>
    const wrongTyp = await reSignPayload({ ...decoded, typ: 'other' }, repository.client!.clientSecret!)
    const expired = await reSignPayload(
      { ...decoded, exp: Math.floor(Date.now() / 1000) - 10 },
      repository.client!.clientSecret!,
    )
    for (const token of [wrongTyp, expired]) {
      await expect(refreshToken(deps, { grantType: refreshTokenGrantType, refreshToken: token })).rejects.toMatchObject(
        { status: 401 },
      )
    }
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
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects an assertion whose expiry is missing or non-numeric', async () => {
    const { deps, clientSecret } = await fixture()
    const subjectToken = await signHs256Jwt(
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
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects an assertion that has already expired', async () => {
    const { deps, clientSecret } = await fixture()
    const subjectToken = await signHs256Jwt(
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
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects an assertion that is not active yet', async () => {
    const { deps, clientSecret } = await fixture()
    const subjectToken = await signHs256Jwt(
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
    ).rejects.toMatchObject({ status: 401 })
  })

  it('ignores a non-numeric not-before claim when the assertion has a valid expiry', async () => {
    const { deps, clientSecret } = await fixture()
    const subjectToken = await signHs256Jwt(
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
    ).resolves.toMatchObject({ issued_token_type: accessTokenType })
  })

  it('treats malformed client grant metadata as an empty grant list', async () => {
    const { deps, clientSecret, repository } = await fixture()
    repository.client = { ...repository.client!, grantTypes: JSON.stringify('not-an-array') }
    const subjectToken = await signHs256Jwt(validClaims(), 'external-platform-secret')

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
    ).rejects.toMatchObject({ status: 401 })
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

async function fixture(options: { grantTypes?: string[]; scopes?: string[]; allowedAudiences?: string[] | null } = {}) {
  const repository = new InMemoryRepository()
  const deps = { tokenExchange: repository, jwks: createJwksGateway() } as unknown as Deps
  const clientSecret = 'runner-client-secret'
  repository.client = {
    clientId: 'runner-client',
    clientSecret: await hashProviderSecret(clientSecret),
    disabled: false,
    grantTypes: JSON.stringify(options.grantTypes ?? [tokenExchangeGrantType]),
    scopes: JSON.stringify(options.scopes ?? ['runner:connect']),
  }
  await createTrustedIssuer(deps, {
    name: 'External Platform',
    issuer: 'https://platform.example.com',
    sharedSecret: 'external-platform-secret',
    allowedAudiences: options.allowedAudiences === undefined ? ['https://ama.example.com'] : options.allowedAudiences,
  })
  return { repository, deps, clientSecret }
}

class InMemoryRepository implements TokenExchangeRepository {
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

  disableIssuer() {
    if (this.issuer) this.issuer = { ...this.issuer, enabled: false }
  }

  async storeAccessToken(input: Parameters<TokenExchangeRepository['storeAccessToken']>[0]) {
    this.tokens.set(input.tokenHash, { ...input, createdAt: new Date(), revokedAt: null })
  }

  async findAccessTokenByHash(tokenHash: string) {
    return this.tokens.get(tokenHash) ?? null
  }

  storedTokens() {
    return this.tokens.size
  }
}

async function reSignPayload(payload: Record<string, unknown>, secret: string) {
  const payloadPart = base64UrlString(JSON.stringify(payload))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart))
  return `fatr_${payloadPart}.${base64Url(new Uint8Array(signature))}`
}

async function signHs256Jwt(payload: Record<string, unknown>, secret: string) {
  const header = base64UrlString(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
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

function base64UrlDecode(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
