import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

function base64Url(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function encodeSegment(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)))
}

/** Mints an HS256 JWT signed with the trusted issuer's shared secret. */
async function hs256Jwt(secret: string, payload: Record<string, unknown>): Promise<string> {
  const signingInput = `${encodeSegment({ alg: 'HS256', typ: 'JWT' })}.${encodeSegment(payload)}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`
}

describe('OAuth token exchange over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('exchanges an HS256 subject token, then introspects the issued token (real SQL)', async () => {
    const cookie = await signInAdmin(harness)
    const audience = 'https://api.example.com'
    const sharedSecret = 'token-exchange-shared-secret-2026'

    // Confidential client allowed to use the token-exchange grant (findClient path).
    const createApp = await harness.request('/api/management/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Exchange Client',
        slug: 'exchange-client',
        clientType: 'confidential_web',
        redirectUris: ['http://localhost/callback'],
        allowedGrantTypes: ['urn:ietf:params:oauth:grant-type:token-exchange'],
      }),
    })
    expect(createApp.status, await createApp.clone().text()).toBe(201)
    const application = (await createApp.json()) as { clientId: string; clientSecret: string }

    // Trusted issuer with a shared secret (createTrustedIssuer + findTrustedIssuer).
    const issuerUrl = 'https://issuer.partner.example.com'
    const createIssuer = await harness.request('/api/management/trusted-issuers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Partner',
        issuer: issuerUrl,
        sharedSecret,
        allowedAudiences: [audience],
      }),
    })
    expect(createIssuer.status, await createIssuer.clone().text()).toBe(201)

    const now = Math.floor(Date.now() / 1000)
    const subjectToken = await hs256Jwt(sharedSecret, {
      iss: issuerUrl,
      sub: 'partner-user-1',
      aud: audience,
      exp: now + 300,
      iat: now,
      email: 'partner-user@example.com',
    })

    const basic = `Basic ${btoa(`${application.clientId}:${application.clientSecret}`)}`
    const exchange = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basic,
        origin: 'http://localhost',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: subjectToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        audience,
      }).toString(),
    })
    expect(exchange.status, await exchange.clone().text()).toBe(200)
    const exchanged = (await exchange.json()) as { access_token: string; token_type: string }
    expect(exchanged.token_type).toBe('Bearer')
    expect(exchanged.access_token).toMatch(/^fatx_/)

    // Introspection reads the stored token by hash (storeAccessToken + findAccessTokenByHash).
    const introspect = await harness.request('/api/auth/oauth2/introspect', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basic,
        origin: 'http://localhost',
      },
      body: new URLSearchParams({ token: exchanged.access_token }).toString(),
    })
    expect(introspect.status, await introspect.clone().text()).toBe(200)
    const introspection = (await introspect.json()) as { active: boolean; sub?: string; aud?: string }
    expect(introspection.active).toBe(true)
    expect(introspection.sub).toBe('partner-user-1')
    expect(introspection.aud).toBe(audience)
  })

  it('rejects an untrusted issuer subject token', async () => {
    const cookie = await signInAdmin(harness)
    const audience = 'https://api.example.com'

    const createApp = await harness.request('/api/management/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Exchange Client 2',
        slug: 'exchange-client-2',
        clientType: 'confidential_web',
        redirectUris: ['http://localhost/callback'],
        allowedGrantTypes: ['urn:ietf:params:oauth:grant-type:token-exchange'],
      }),
    })
    const application = (await createApp.json()) as { clientId: string; clientSecret: string }

    const now = Math.floor(Date.now() / 1000)
    const subjectToken = await hs256Jwt('whatever-secret-1234567890', {
      iss: 'https://unknown.example.com',
      sub: 'x',
      aud: audience,
      exp: now + 300,
      iat: now,
    })

    const basic = `Basic ${btoa(`${application.clientId}:${application.clientSecret}`)}`
    const exchange = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basic,
        origin: 'http://localhost',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: subjectToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        audience,
      }).toString(),
    })
    expect(exchange.status).toBe(401)
  })
})
