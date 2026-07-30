import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { baseURL, createHarness, type Harness, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

function base64Url(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]
  expect(payload).toBeTruthy()
  const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')
  return JSON.parse(atob(padded.replaceAll('-', '+').replaceAll('_', '/'))) as Record<string, unknown>
}

function decodeJwtHeader(token: string): Record<string, unknown> {
  const header = token.split('.')[0]
  expect(header).toBeTruthy()
  const padded = header.padEnd(Math.ceil(header.length / 4) * 4, '=')
  return JSON.parse(atob(padded.replaceAll('-', '+').replaceAll('_', '/'))) as Record<string, unknown>
}

function decodeBase64Url(value: string): ArrayBuffer {
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded.replaceAll('-', '+').replaceAll('_', '/')), (character) => character.charCodeAt(0))
    .buffer as ArrayBuffer
}

type PublishedJwk = JsonWebKey & { alg?: string; kid?: string }

describe('OIDC authorization over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('preserves resource and issues a verifiable RS256 identity token [spec: hosted-auth/oidc-resource-authorization] [spec: hosted-auth/oidc-native-token-verification]', async () => {
    await env.DB.prepare(
      `INSERT INTO jwks (id, public_key, private_key, alg, crv, created_at, expires_at)
       VALUES (?, ?, ?, 'ES256', 'P-256', ?, NULL)`,
    )
      .bind(
        'legacy-es256-key',
        JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'legacy-x', y: 'legacy-y' }),
        '{}',
        Date.now(),
      )
      .run()

    const cookie = await signInAdmin(harness)
    const redirectUri = 'http://localhost/callback'
    const verifier = 'resource-flow-pkce-verifier-0123456789abcdefghijklmnop'
    const resource = `${baseURL}/api/auth`

    const createApp = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Resource SPA',
        slug: 'resource-spa',
        clientType: 'public_spa',
        redirectUris: [redirectUri],
        firstParty: true,
        trusted: true,
      }),
    })
    expect(createApp.status, await createApp.clone().text()).toBe(201)
    const application = (await createApp.json()) as { clientId: string }

    const authorizeParams = new URLSearchParams({
      response_type: 'code',
      client_id: application.clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      state: 'resource-state',
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: 'S256',
      resource,
    })

    const signedOut = await harness.request(`/api/auth/oauth2/authorize?${authorizeParams}`, { redirect: 'manual' })
    expect(signedOut.status).toBe(302)
    const signInUrl = new URL(signedOut.headers.get('location') ?? '', baseURL)
    expect(signInUrl.pathname).toBe('/auth/sign-in')
    expect(signInUrl.searchParams.get('resource')).toBe(resource)

    const authorized = await harness.request(`/api/auth/oauth2/authorize?${authorizeParams}`, {
      headers: { cookie },
      redirect: 'manual',
    })
    expect(authorized.status, await authorized.clone().text()).toBe(302)
    const callbackUrl = new URL(authorized.headers.get('location') ?? '', redirectUri)
    const code = callbackUrl.searchParams.get('code')
    expect(code).toBeTruthy()

    const token = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: application.clientId,
        redirect_uri: redirectUri,
        code: code ?? '',
        code_verifier: verifier,
      }),
    })
    expect(token.status, await token.clone().text()).toBe(200)
    const tokenBody = (await token.json()) as { access_token: string; id_token: string }
    const payload = decodeJwtPayload(tokenBody.access_token)
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud]

    expect(audience).toContain(resource)
    expect(payload.azp).toBe(application.clientId)

    const header = decodeJwtHeader(tokenBody.id_token)
    expect(header).toMatchObject({ alg: 'RS256', kid: expect.any(String) })

    const jwksResponse = await harness.request('/api/auth/jwks')
    expect(jwksResponse.status, await jwksResponse.clone().text()).toBe(200)
    const jwks = (await jwksResponse.json()) as { keys: PublishedJwk[] }
    const signingKey = jwks.keys.find((key) => key.kid === header.kid)
    expect(signingKey).toMatchObject({ alg: 'RS256', kty: 'RSA' })
    expect(jwks.keys).toEqual(
      expect.arrayContaining([expect.objectContaining({ alg: 'ES256', kid: 'legacy-es256-key', kty: 'EC' })]),
    )

    const verificationKey = await crypto.subtle.importKey(
      'jwk',
      signingKey!,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const [encodedHeader, encodedPayload, encodedSignature] = tokenBody.id_token.split('.')
    const verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      verificationKey,
      decodeBase64Url(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    )
    expect(verified).toBe(true)
  })
})
