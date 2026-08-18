import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  baseURL,
  createHarness,
  type Harness,
  platformOrganizationId,
  resourceOpenApiFetch,
  signInAdmin,
} from './harness'

afterEach(async () => {
  vi.unstubAllGlobals()
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

function jwtAudiences(token: string) {
  const audience = decodeJwtPayload(token).aud
  return Array.isArray(audience) ? audience : [audience]
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

    const resource = 'https://resource.example.com'
    harness = await createHarness({ validAudiences: [baseURL, resource] })
    const cookie = await signInAdmin(harness)
    const redirectUri = 'http://localhost/callback'
    const verifier = 'resource-flow-pkce-verifier-0123456789abcdefghijklmnop'
    harness.deps.externalHttp.fetch = resourceOpenApiFetch
    const createResource = await harness.request('/api/resource-servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        identifier: 'oidc-resource',
        resourceUrl: resource,
        authorizationModel: 'native',
        ownerOrganizationId: platformOrganizationId,
      }),
    })
    expect(createResource.status, await createResource.clone().text()).toBe(201)

    const createApp = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Resource SPA',
        slug: 'resource-spa',
        clientType: 'public_spa',
        redirectUris: [redirectUri],
        ownerOrganizationId: platformOrganizationId,
        consentRequired: false,
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
        resource,
      }),
    })
    expect(token.status, await token.clone().text()).toBe(200)
    const tokenBody = (await token.json()) as { access_token: string; id_token: string }
    const payload = decodeJwtPayload(tokenBody.access_token)
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud]

    expect(audience).toContain(resource)
    expect(payload.client_id).toBe(application.clientId)
    expect(payload).not.toHaveProperty('azp')

    const header = decodeJwtHeader(tokenBody.id_token)
    expect(header).toMatchObject({ alg: 'RS256', kid: expect.any(String) })

    const jwksResponse = await harness.request('/api/auth/jwks')
    expect(jwksResponse.status, await jwksResponse.clone().text()).toBe(200)
    const jwksProbe = await harness.request('/api/auth/jwks', { method: 'HEAD' })
    expect(jwksProbe.status).toBe(200)
    expect(jwksProbe.headers.get('content-type')).toBe('application/json; charset=UTF-8')
    const jwks = (await jwksResponse.json()) as { keys: PublishedJwk[] }
    const wellKnownJwks = await harness.request('/.well-known/jwks.json')
    expect(wellKnownJwks.status, await wellKnownJwks.clone().text()).toBe(200)
    expect(await wellKnownJwks.json()).toEqual(jwks)
    expect((await harness.request('/.well-known/jwks.json', { method: 'HEAD' })).status).toBe(200)
    const signingKey = jwks.keys.find((key) => key.kid === header.kid)
    expect(signingKey).toMatchObject({ alg: 'RS256', key_ops: ['verify'], kty: 'RSA', use: 'sig' })
    expect(jwks.keys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alg: 'ES256',
          key_ops: ['verify'],
          kid: 'legacy-es256-key',
          kty: 'EC',
          use: 'sig',
        }),
      ]),
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

  it('binds a refresh token to the complete multi-resource grant [spec: hosted-auth/oauth-multi-resource-grant]', async () => {
    const resources = [
      { url: 'https://calendar.example.com', scope: 'calendar:read' },
      { url: 'https://contacts.example.com', scope: 'contacts:read' },
      { url: 'https://files.example.com', scope: 'files:read' },
    ]
    harness = await createHarness({ validAudiences: [baseURL, ...resources.map((resource) => resource.url)] })
    harness.deps.externalHttp.fetch = async (request) => {
      const target = resources.find((resource) => request.url.includes(new URL(resource.url).host))
      if (!target) throw new Error(`Unexpected resource discovery request: ${request.url}`)
      if (request.url.includes('/.well-known/oauth-protected-resource')) {
        return Response.json({ resource: target.url, scopes_supported: [target.scope] })
      }
      if (new URL(request.url).pathname.endsWith('/openapi.json')) {
        return Response.json({
          openapi: '3.1.0',
          info: { title: `${target.scope} API`, version: '1.0.0' },
          paths: {},
        })
      }
      return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
    }
    const cookie = await signInAdmin(harness)
    const resourceIds: string[] = []
    for (const [index, target] of resources.entries()) {
      const response = await harness.request('/api/resource-servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          identifier: `multi-resource-${index + 1}`,
          resourceUrl: target.url,
          authorizationModel: 'native',
          ownerOrganizationId: platformOrganizationId,
          visibility: 'public',
        }),
      })
      expect(response.status, await response.clone().text()).toBe(201)
      const resource = (await response.json()) as { id: string }
      resourceIds.push(resource.id)
      const update = await harness.request(`/api/resource-servers/${resource.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ scopeGrantModes: [{ scope: target.scope, grantMode: 'automatic' }] }),
      })
      expect(update.status, await update.clone().text()).toBe(200)
    }

    const redirectUri = 'http://localhost/multi-resource-callback'
    const createApp = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Multi-resource SPA',
        slug: 'multi-resource-spa',
        clientType: 'public_spa',
        redirectUris: [redirectUri],
        ownerOrganizationId: platformOrganizationId,
        consentRequired: false,
        resourceScopes: resourceIds.map((resourceServerId, index) => ({
          resourceServerId,
          scopes: [resources[index]!.scope],
        })),
      }),
    })
    expect(createApp.status, await createApp.clone().text()).toBe(201)
    const application = (await createApp.json()) as { clientId: string }
    const verifier = 'multi-resource-pkce-verifier-0123456789abcdefghijklmnop'
    const authorizeParams = new URLSearchParams({
      response_type: 'code',
      client_id: application.clientId,
      redirect_uri: redirectUri,
      scope: `openid offline_access ${resources
        .slice(0, 2)
        .map((resource) => resource.scope)
        .join(' ')}`,
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: 'S256',
    })
    authorizeParams.append('resource', resources[0].url)
    authorizeParams.append('resource', resources[1].url)

    const authorized = await harness.request(`/api/auth/oauth2/authorize?${authorizeParams}`, {
      headers: { cookie },
      redirect: 'manual',
    })
    expect(authorized.status, await authorized.clone().text()).toBe(302)
    const code = new URL(authorized.headers.get('location') ?? '', redirectUri).searchParams.get('code')
    expect(code).toBeTruthy()

    const initialToken = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: application.clientId,
        redirect_uri: redirectUri,
        code: code ?? '',
        code_verifier: verifier,
        resource: resources[0].url,
      }),
    })
    expect(initialToken.status, await initialToken.clone().text()).toBe(200)
    const initialBody = (await initialToken.json()) as { access_token: string; refresh_token: string; scope: string }
    expect(jwtAudiences(initialBody.access_token)).toEqual([resources[0].url])
    expect(initialBody.scope.split(' ')).toEqual(['openid', 'offline_access', resources[0].scope])
    expect(initialBody.refresh_token).toBeTruthy()

    const missingTarget = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: application.clientId,
        refresh_token: initialBody.refresh_token,
      }),
    })
    expect(missingTarget.status).toBe(400)
    await expect(missingTarget.json()).resolves.toMatchObject({ error: 'invalid_target' })

    const secondToken = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: application.clientId,
        refresh_token: initialBody.refresh_token,
        resource: resources[1].url,
      }),
    })
    expect(secondToken.status, await secondToken.clone().text()).toBe(200)
    const secondBody = (await secondToken.json()) as { access_token: string; refresh_token: string; scope: string }
    expect(jwtAudiences(secondBody.access_token)).toEqual([resources[1].url])
    expect(secondBody.scope.split(' ')).toEqual(['openid', 'offline_access', resources[1].scope])

    const outsideGrant = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: application.clientId,
        refresh_token: secondBody.refresh_token,
        resource: resources[2].url,
      }),
    })
    expect(outsideGrant.status).toBe(400)
    await expect(outsideGrant.json()).resolves.toMatchObject({ error: 'invalid_target' })
  })

  it('expires the provider browser session during RP-initiated logout [spec: hosted-auth/oidc-provider-logout]', async () => {
    const cookie = await signInAdmin(harness)
    const redirectUri = 'http://localhost/callback'
    const postLogoutRedirectUri = 'http://localhost/signed-out'
    const verifier = 'logout-flow-pkce-verifier-0123456789abcdefghijklmnop'
    const createApp = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Logout SPA',
        slug: 'logout-spa',
        clientType: 'confidential_web',
        redirectUris: [redirectUri],
        postLogoutRedirectUris: [postLogoutRedirectUri],
        ownerOrganizationId: platformOrganizationId,
        consentRequired: false,
      }),
    })
    expect(createApp.status, await createApp.clone().text()).toBe(201)
    const application = (await createApp.json()) as { clientId: string; clientSecret: string }
    const authorizeParams = new URLSearchParams({
      response_type: 'code',
      client_id: application.clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      state: 'logout-state',
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: 'S256',
    })
    const authorized = await harness.request(`/api/auth/oauth2/authorize?${authorizeParams}`, {
      headers: { cookie },
      redirect: 'manual',
    })
    expect(authorized.status, await authorized.clone().text()).toBe(302)
    const code = new URL(authorized.headers.get('location') ?? '', redirectUri).searchParams.get('code')
    expect(code).toBeTruthy()

    const token = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${application.clientId}:${application.clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code: code ?? '',
        code_verifier: verifier,
      }),
    })
    expect(token.status, await token.clone().text()).toBe(200)
    const { access_token: accessToken, id_token: idToken } = (await token.json()) as {
      access_token: string
      id_token: string
    }
    expect(decodeJwtHeader(accessToken).typ).toBe('at+jwt')
    expect(decodeJwtPayload(accessToken)).toMatchObject({
      aud: `${baseURL}/api/auth/oauth2/userinfo`,
      client_id: application.clientId,
      jti: expect.any(String),
    })
    const identityOnlyClaims = ['authorization', 'roles', 'groups', 'application_id', 'organization_id']
    const idPayload = decodeJwtPayload(idToken)
    for (const claim of identityOnlyClaims) expect(idPayload).not.toHaveProperty(claim)
    expect(idPayload).not.toHaveProperty('urn:realmroot:params:oauth:tenant')

    const userInfo = await harness.request('/api/auth/oauth2/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(userInfo.status, await userInfo.clone().text()).toBe(200)
    const userInfoBody = (await userInfo.json()) as Record<string, unknown>
    expect(userInfoBody).toMatchObject({ sub: idPayload.sub })
    for (const claim of identityOnlyClaims) expect(userInfoBody).not.toHaveProperty(claim)
    expect(userInfoBody).not.toHaveProperty('urn:realmroot:params:oauth:tenant')

    const introspection = await harness.request('/api/auth/oauth2/introspect', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${application.clientId}:${application.clientSecret}`)}`,
      },
      body: new URLSearchParams({ token: accessToken }),
    })
    expect(introspection.status, await introspection.clone().text()).toBe(200)
    expect(await introspection.json()).toMatchObject({ active: true, client_id: application.clientId })
    const jwks = await harness.request('/api/auth/jwks')
    expect(jwks.status, await jwks.clone().text()).toBe(200)
    const jwksBody = await jwks.text()
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      if (new URL(input instanceof Request ? input.url : input.toString()).pathname === '/api/auth/jwks') {
        return new Response(jwksBody, { headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected integration fetch: ${input.toString()}`)
    })

    const logout = await harness.request(
      `/api/auth/oauth2/end-session?${new URLSearchParams({
        id_token_hint: idToken,
        post_logout_redirect_uri: postLogoutRedirectUri,
      })}`,
      { headers: { cookie }, redirect: 'manual' },
    )
    expect(logout.status, await logout.clone().text()).toBe(302)
    expect(logout.headers.get('location')).toBe(postLogoutRedirectUri)
    const setCookie = logout.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('better-auth.session_token=')
    expect(setCookie).toContain('better-auth.session_data=')
    expect(setCookie).toMatch(/Max-Age=0/i)

    const expiredCookieNames = new Set(
      setCookie
        .split(',')
        .map((entry) => entry.trim().split('=')[0])
        .filter(Boolean),
    )
    const browserCookieAfterLogout = cookie
      .split('; ')
      .filter((entry) => !expiredCookieNames.has(entry.split('=')[0]))
      .join('; ')
    const authorizeAfterLogout = await harness.request(`/api/auth/oauth2/authorize?${authorizeParams}`, {
      headers: browserCookieAfterLogout ? { cookie: browserCookieAfterLogout } : undefined,
      redirect: 'manual',
    })
    expect(authorizeAfterLogout.status).toBe(302)
    expect(new URL(authorizeAfterLogout.headers.get('location') ?? '', baseURL).pathname).toBe('/auth/sign-in')
  })
})
