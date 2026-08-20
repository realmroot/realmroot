import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  baseURL,
  createHarness,
  createUser,
  type Harness,
  platformOrganizationId,
  resignOAuthQuery,
  resourceOpenApiFetch,
  signIn,
  signInAdmin,
} from './harness'

const organizationClaim = 'urn:realmroot:params:oauth:org'

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

function mergeResponseCookies(currentCookie: string, response: Response) {
  const cookies = new Map<string, string>()
  for (const pair of currentCookie.split(';')) {
    const separator = pair.indexOf('=')
    if (separator > 0) cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim())
  }
  for (const part of (response.headers.get('set-cookie') ?? '').split(',')) {
    const pair = part.trim().split(';')[0]
    const separator = pair.indexOf('=')
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
}

async function continueOAuthContext(
  harness: Harness,
  cookie: string,
  contextRedirect: Response,
  consentReferenceId: string,
) {
  const contextUrl = new URL(contextRedirect.headers.get('location') ?? '', baseURL)
  expect(contextUrl.pathname).toBe('/auth/context')
  const continued = await harness.request('/api/auth/oauth2/continue', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: baseURL },
    body: JSON.stringify({
      postLogin: true,
      consentReferenceId,
      oauth_query: contextUrl.search.slice(1),
    }),
  })
  expect(continued.status, await continued.clone().text()).toBe(200)
  const result = (await continued.json()) as { url: string }
  return new URL(result.url, baseURL)
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

  it('enforces private Application membership at authorization and refresh [spec: hosted-auth/application-visibility-admission]', async () => {
    const adminCookie = await signInAdmin(harness)
    const outsiderUserId = await createUser(harness, adminCookie, {
      email: 'oidc-outsider@example.com',
      username: 'oidc-outsider',
      displayName: 'OIDC Outsider',
      password: 'oidc-outsider-password-2026',
    })
    const outsiderCookie = await signIn(harness, 'oidc-outsider@example.com', 'oidc-outsider-password-2026')
    const redirectUri = 'http://localhost/private-callback'
    const createNativeApp = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        name: 'Private Native Membership App',
        clientType: 'public_native',
        redirectUris: ['com.example.private:/callback'],
        ownerOrganizationId: platformOrganizationId,
        visibility: 'private',
        deviceLoginEnabled: true,
      }),
    })
    expect(createNativeApp.status, await createNativeApp.clone().text()).toBe(201)
    const nativeApplication = (await createNativeApp.json()) as { clientId: string }
    const deviceCode = await harness.request('/api/auth/device/code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: nativeApplication.clientId, scope: 'openid groups' }),
    })
    expect(deviceCode.status, await deviceCode.clone().text()).toBe(200)
    const { user_code: userCode } = (await deviceCode.json()) as { user_code: string }
    const deviceApproval = await harness.request('/api/auth/device/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: outsiderCookie },
      body: JSON.stringify({ userCode }),
    })
    expect(deviceApproval.status).toBe(403)
    await expect(deviceApproval.json()).resolves.toMatchObject({ error: 'access_denied' })

    const createApp = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        name: 'Private Membership App',
        clientType: 'confidential_web',
        redirectUris: [redirectUri],
        ownerOrganizationId: platformOrganizationId,
        visibility: 'private',
        consentRequired: false,
      }),
    })
    expect(createApp.status, await createApp.clone().text()).toBe(201)
    const application = (await createApp.json()) as { clientId: string; clientSecret: string }
    const verifier = 'private-membership-pkce-verifier-0123456789abcdefghijklmnop'
    const authorizeParams = new URLSearchParams({
      response_type: 'code',
      client_id: application.clientId,
      redirect_uri: redirectUri,
      scope: 'openid offline_access',
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: 'S256',
    })

    const denied = await harness.request(`/api/auth/oauth2/authorize?${authorizeParams}`, {
      headers: { cookie: outsiderCookie },
      redirect: 'manual',
    })
    expect(denied.status).not.toBe(302)

    const addOutsider = await harness.request(`/api/organizations/${platformOrganizationId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ userId: outsiderUserId, roles: ['member'] }),
    })
    expect(addOutsider.status, await addOutsider.clone().text()).toBe(201)
    const outsiderMember = (await addOutsider.json()) as { id: string }

    const authorized = await harness.request(`/api/auth/oauth2/authorize?${authorizeParams}`, {
      headers: { cookie: outsiderCookie },
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
    const tokenBody = (await token.json()) as { refresh_token: string }
    const removeOutsider = await harness.request(
      `/api/organizations/${platformOrganizationId}/members/${outsiderMember.id}`,
      { method: 'DELETE', headers: { cookie: adminCookie } },
    )
    expect(removeOutsider.status, await removeOutsider.clone().text()).toBe(204)

    const refresh = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${application.clientId}:${application.clientSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokenBody.refresh_token }),
    })
    expect(refresh.status).toBe(400)
    await expect(refresh.json()).resolves.toMatchObject({ error: 'invalid_grant' })

    const readdOutsider = await harness.request(`/api/organizations/${platformOrganizationId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ userId: outsiderUserId, roles: ['member'] }),
    })
    expect(readdOutsider.status, await readdOutsider.clone().text()).toBe(201)
    const staleRefresh = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${application.clientId}:${application.clientSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokenBody.refresh_token }),
    })
    expect(staleRefresh.status).toBe(400)
    await expect(staleRefresh.json()).resolves.toMatchObject({ error: 'invalid_grant' })
  })

  it('issues public Application tokens to an external user without owner Organization claims', async () => {
    const adminCookie = await signInAdmin(harness)
    const publicUserId = await createUser(harness, adminCookie, {
      email: 'public-oidc-user@example.com',
      username: 'public-oidc-user',
      displayName: 'Public OIDC User',
      password: 'public-oidc-user-password-2026',
    })
    let userCookie = await signIn(harness, 'public-oidc-user@example.com', 'public-oidc-user-password-2026')
    const now = Date.now()
    await env.DB.prepare(
      'INSERT INTO organization (id, slug, name, disabled, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
    )
      .bind('org-stale-session', 'stale-session', 'Stale session', now, now)
      .run()
    await env.DB.prepare(
      'INSERT INTO member (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind('member-stale-session', 'org-stale-session', publicUserId, 'member', now, now)
      .run()
    const activeOrganization = await harness.request('/api/auth/organization/set-active', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: userCookie, origin: baseURL },
      body: JSON.stringify({ organizationId: 'org-stale-session' }),
    })
    expect(activeOrganization.status, await activeOrganization.clone().text()).toBe(200)
    userCookie = mergeResponseCookies(userCookie, activeOrganization)
    await env.DB.prepare('DELETE FROM member WHERE id = ?').bind('member-stale-session').run()
    const redirectUri = 'http://localhost/public-callback'
    const createApp = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        name: 'Public Membership App',
        clientType: 'confidential_web',
        redirectUris: [redirectUri],
        ownerOrganizationId: platformOrganizationId,
        visibility: 'public',
        consentRequired: false,
      }),
    })
    expect(createApp.status, await createApp.clone().text()).toBe(201)
    const application = (await createApp.json()) as { clientId: string; clientSecret: string }
    const verifier = 'public-membership-pkce-verifier-0123456789abcdefghijklmnop'
    const authorizeParams = new URLSearchParams({
      response_type: 'code',
      client_id: application.clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile email groups',
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: 'S256',
    })
    const authorized = await harness.request(`/api/auth/oauth2/authorize?${authorizeParams}`, {
      headers: { cookie: userCookie },
      redirect: 'manual',
    })
    expect(authorized.status, await authorized.clone().text()).toBe(302)
    const code = new URL(authorized.headers.get('location') ?? '', redirectUri).searchParams.get('code')
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
    const body = (await token.json()) as { access_token: string; id_token: string }
    for (const claims of [decodeJwtPayload(body.access_token), decodeJwtPayload(body.id_token)]) {
      expect(claims).not.toHaveProperty('urn:realmroot:params:oauth:org')
      expect(claims).not.toHaveProperty('groups')
    }
  })

  it('rejects public Application authorization after its owner Organization is disabled [spec: hosted-auth/application-visibility-admission]', async () => {
    const cookie = await signInAdmin(harness)
    const now = Date.now()
    await env.DB.prepare(
      'INSERT INTO organization (id, slug, name, disabled, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
    )
      .bind('org-disabled-client', 'disabled-client', 'Disabled client owner', now, now)
      .run()
    const redirectUri = 'http://localhost/disabled-owner-callback'
    const createApplication = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Disabled Owner Public App',
        clientType: 'public_spa',
        redirectUris: [redirectUri],
        ownerOrganizationId: 'org-disabled-client',
        visibility: 'public',
      }),
    })
    expect(createApplication.status, await createApplication.clone().text()).toBe(201)
    const application = (await createApplication.json()) as { clientId: string }
    await env.DB.prepare('UPDATE organization SET disabled = 1 WHERE id = ?').bind('org-disabled-client').run()

    const authorize = await harness.request(
      `/api/auth/oauth2/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: application.clientId,
        redirect_uri: redirectUri,
        scope: 'openid',
        code_challenge: await pkceChallenge('disabled-owner-verifier-0123456789abcdefghijklmnop'),
        code_challenge_method: 'S256',
      })}`,
      { headers: { cookie }, redirect: 'manual' },
    )
    expect(authorize.status).toBe(403)
    await expect(authorize.json()).resolves.toMatchObject({ error: 'access_denied' })
  })

  it('emits consistent Team groups for shared Kubernetes and Argo CD Applications', async () => {
    const cookie = await signInAdmin(harness)
    const admin = await env.DB.prepare('SELECT user_id AS userId FROM member WHERE organization_id = ? LIMIT 1')
      .bind(platformOrganizationId)
      .first<{ userId: string }>()
    expect(admin?.userId).toBeTruthy()
    await env.DB.prepare('INSERT INTO team (id, name, organization_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind('team-platform-operators', 'platform-operators', platformOrganizationId, Date.now(), Date.now())
      .run()
    await env.DB.prepare('INSERT INTO team_member (id, team_id, user_id, created_at) VALUES (?, ?, ?, ?)')
      .bind('team-member-platform-operator', 'team-platform-operators', admin!.userId, Date.now())
      .run()

    const applications = [] as Array<{
      clientId: string
      clientSecret?: string
      redirectUri: string
    }>
    for (const input of [
      {
        name: 'Shared Kubernetes',
        clientType: 'public_native',
        redirectUris: ['com.example.kubectl:/callback'],
      },
      {
        name: 'Shared Argo CD',
        clientType: 'confidential_web',
        redirectUris: ['https://argo-a.example.com/auth/callback', 'https://argo-b.example.com/auth/callback'],
      },
    ]) {
      const response = await harness.request('/api/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          ...input,
          ownerOrganizationId: platformOrganizationId,
          visibility: 'private',
          consentRequired: false,
        }),
      })
      expect(response.status, await response.clone().text()).toBe(201)
      const application = (await response.json()) as {
        clientId: string
        clientSecret?: string
        redirectUris: string[]
      }
      expect(application.redirectUris).toEqual(input.redirectUris)
      for (const redirectUri of application.redirectUris) {
        applications.push({
          clientId: application.clientId,
          clientSecret: application.clientSecret,
          redirectUri,
        })
      }
    }

    const identityClaims: Record<string, unknown>[] = []
    for (const [index, application] of applications.entries()) {
      const verifier = `shared-application-verifier-${index}-0123456789abcdefghijklmnop`
      const authorizeParams = new URLSearchParams({
        response_type: 'code',
        client_id: application.clientId,
        redirect_uri: application.redirectUri,
        scope: 'openid profile email groups',
        code_challenge: await pkceChallenge(verifier),
        code_challenge_method: 'S256',
      })
      const authorized = await harness.request(`/api/auth/oauth2/authorize?${authorizeParams}`, {
        headers: { cookie },
        redirect: 'manual',
      })
      expect(authorized.status, await authorized.clone().text()).toBe(302)
      const code = new URL(authorized.headers.get('location') ?? '', application.redirectUri).searchParams.get('code')
      const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
      if (application.clientSecret) {
        headers.authorization = `Basic ${btoa(`${application.clientId}:${application.clientSecret}`)}`
      }
      const token = await harness.request('/api/auth/oauth2/token', {
        method: 'POST',
        headers,
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: application.clientId,
          redirect_uri: application.redirectUri,
          code: code ?? '',
          code_verifier: verifier,
        }),
      })
      expect(token.status, await token.clone().text()).toBe(200)
      identityClaims.push(decodeJwtPayload(((await token.json()) as { id_token: string }).id_token))
    }
    for (const claims of identityClaims) {
      expect(claims['urn:realmroot:params:oauth:org']).toBe(platformOrganizationId)
      expect(claims.groups).toEqual(['platform-operators'])
    }
  })

  it('issues Organization and Team claims through the Kubernetes Device flow [spec: admin-console/oidc-group-application-boundary]', async () => {
    const cookie = await signInAdmin(harness)
    const admin = await env.DB.prepare('SELECT user_id AS userId FROM member WHERE organization_id = ? LIMIT 1')
      .bind(platformOrganizationId)
      .first<{ userId: string }>()
    expect(admin?.userId).toBeTruthy()
    await env.DB.prepare('INSERT INTO team (id, name, organization_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind('team-device-operators', 'device-operators', platformOrganizationId, Date.now(), Date.now())
      .run()
    await env.DB.prepare('INSERT INTO team_member (id, team_id, user_id, created_at) VALUES (?, ?, ?, ?)')
      .bind('team-member-device-operator', 'team-device-operators', admin!.userId, Date.now())
      .run()

    const createApplication = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Kubernetes Device Client',
        clientType: 'public_native',
        redirectUris: ['com.example.kubernetes:/callback'],
        ownerOrganizationId: platformOrganizationId,
        visibility: 'private',
        deviceLoginEnabled: true,
      }),
    })
    expect(createApplication.status, await createApplication.clone().text()).toBe(201)
    const application = (await createApplication.json()) as { clientId: string }
    const deviceAuthorization = await harness.request('/api/auth/device/code', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: application.clientId, scope: 'openid profile email groups' }),
    })
    expect(deviceAuthorization.status, await deviceAuthorization.clone().text()).toBe(200)
    const device = (await deviceAuthorization.json()) as { device_code: string; user_code: string }
    const verification = await harness.request(`/api/auth/device?user_code=${encodeURIComponent(device.user_code)}`, {
      headers: { cookie },
    })
    expect(verification.status, await verification.clone().text()).toBe(200)

    const approval = await harness.request('/api/auth/device/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: baseURL },
      body: JSON.stringify({ userCode: device.user_code }),
    })
    expect(approval.status, await approval.clone().text()).toBe(200)

    const token = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: application.clientId,
        device_code: device.device_code,
      }),
    })
    expect(token.status, await token.clone().text()).toBe(200)
    const tokenBody = (await token.json()) as { access_token: string; id_token: string }
    const accessClaims = decodeJwtPayload(tokenBody.access_token)
    expect(accessClaims['urn:realmroot:params:oauth:org']).toBe(platformOrganizationId)
    expect(accessClaims.groups).toEqual(['device-operators'])
    const idClaims = decodeJwtPayload(tokenBody.id_token)
    expect(idClaims['urn:realmroot:params:oauth:org']).toBe(platformOrganizationId)
    expect(idClaims.groups).toEqual(['device-operators'])
    expect(idClaims).not.toHaveProperty('roles')
    expect(Number(idClaims.exp) - Number(idClaims.iat)).toBe(10 * 60)
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
        visibility: 'public',
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
        visibility: 'public',
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

    const contextRedirect = await harness.request(`/api/auth/oauth2/authorize?${authorizeParams}`, {
      headers: { cookie },
      redirect: 'manual',
    })
    const admin = await env.DB.prepare('SELECT user_id AS userId FROM member WHERE organization_id = ? LIMIT 1')
      .bind(platformOrganizationId)
      .first<{ userId: string }>()
    expect(admin?.userId).toBeTruthy()
    const callbackUrl = await continueOAuthContext(harness, cookie, contextRedirect, `user:${admin!.userId}`)
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
    expect(decodeJwtPayload(tokenBody.id_token)).not.toHaveProperty('urn:realmroot:params:oauth:org')

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

  it('[spec: hosted-auth/oauth-authorization-context-selection] isolates concurrent authorization Context selections by signed query', async () => {
    const resource = 'https://context-resource.example.com'
    harness = await createHarness({ validAudiences: [baseURL, resource] })
    harness.deps.externalHttp.fetch = resourceOpenApiFetch
    const cookie = await signInAdmin(harness)
    const admin = await env.DB.prepare('SELECT user_id AS userId FROM member WHERE organization_id = ? LIMIT 1')
      .bind(platformOrganizationId)
      .first<{ userId: string }>()
    expect(admin?.userId).toBeTruthy()
    const now = Date.now()
    for (const organizationId of ['org-context-a', 'org-context-b']) {
      await env.DB.prepare(
        'INSERT INTO organization (id, slug, name, disabled, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
      )
        .bind(organizationId, organizationId, organizationId, now, now)
        .run()
      await env.DB.prepare(
        'INSERT INTO member (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind(`member-${organizationId}`, organizationId, admin!.userId, 'member', now, now)
        .run()
    }
    const createResource = await harness.request('/api/resource-servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        identifier: 'context-selection-resource',
        resourceUrl: resource,
        authorizationModel: 'native',
        ownerOrganizationId: platformOrganizationId,
        visibility: 'public',
      }),
    })
    expect(createResource.status, await createResource.clone().text()).toBe(201)
    const redirectUri = 'http://localhost/context-callback'
    const createApplication = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Concurrent Context App',
        clientType: 'public_spa',
        redirectUris: [redirectUri],
        ownerOrganizationId: platformOrganizationId,
        visibility: 'public',
        consentRequired: false,
      }),
    })
    expect(createApplication.status, await createApplication.clone().text()).toBe(201)
    const application = (await createApplication.json()) as { clientId: string }
    const attempts = await Promise.all(
      ['a', 'b'].map(async (suffix) => {
        const verifier = `context-${suffix}-verifier-0123456789abcdefghijklmnop`
        const params = new URLSearchParams({
          response_type: 'code',
          client_id: application.clientId,
          redirect_uri: redirectUri,
          scope: 'openid',
          state: `state-${suffix}`,
          code_challenge: await pkceChallenge(verifier),
          code_challenge_method: 'S256',
          resource,
        })
        const redirect = await harness.request(`/api/auth/oauth2/authorize?${params}`, {
          headers: { cookie },
          redirect: 'manual',
        })
        return { suffix, verifier, redirect }
      }),
    )
    const firstContextUrl = new URL(attempts[0]!.redirect.headers.get('location') ?? '', baseURL)
    const missingReference = await harness.request('/api/auth/oauth2/continue', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: baseURL },
      body: JSON.stringify({ postLogin: true, oauth_query: firstContextUrl.search.slice(1) }),
    })
    expect(missingReference.status).toBe(400)
    await expect(missingReference.json()).resolves.toMatchObject({ error: 'invalid_request' })

    const tokens = [] as Array<{ organizationId: string; accessToken: string; idToken: string }>
    for (const [index, attempt] of attempts.entries()) {
      const organizationId = `org-context-${index === 0 ? 'a' : 'b'}`
      const callback = await continueOAuthContext(harness, cookie, attempt.redirect, `organization:${organizationId}`)
      expect(callback.searchParams.get('state')).toBe(`state-${attempt.suffix}`)
      const token = await harness.request('/api/auth/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: application.clientId,
          redirect_uri: redirectUri,
          code: callback.searchParams.get('code') ?? '',
          code_verifier: attempt.verifier,
          resource,
        }),
      })
      expect(token.status, await token.clone().text()).toBe(200)
      const tokenBody = (await token.json()) as { access_token: string; id_token: string }
      tokens.push({ organizationId, accessToken: tokenBody.access_token, idToken: tokenBody.id_token })
    }
    for (const { organizationId, accessToken, idToken } of tokens) {
      expect(decodeJwtPayload(accessToken)[organizationClaim]).toBe(organizationId)
      expect(decodeJwtPayload(idToken)[organizationClaim]).toBe(organizationId)
    }
  })

  it('[spec: hosted-auth/oauth-authorization-context-selection] binds and atomically consumes each post-login authorization attempt', async () => {
    const resource = 'https://attempt-resource.example.com'
    harness = await createHarness({ validAudiences: [baseURL, resource] })
    harness.deps.externalHttp.fetch = resourceOpenApiFetch
    const ownerCookie = await signInAdmin(harness)
    const owner = await env.DB.prepare('SELECT user_id AS userId FROM member WHERE organization_id = ? LIMIT 1')
      .bind(platformOrganizationId)
      .first<{ userId: string }>()
    expect(owner?.userId).toBeTruthy()
    const otherPassword = 'other-session-password-2026'
    await createUser(harness, ownerCookie, {
      email: 'other-attempt-user@example.com',
      username: 'other-attempt-user',
      displayName: 'Other Attempt User',
      password: otherPassword,
    })
    const otherCookie = await signIn(harness, 'other-attempt-user@example.com', otherPassword)

    const staleOrganizationId = 'org-attempt-stale'
    const now = Date.now()
    await env.DB.prepare(
      'INSERT INTO organization (id, slug, name, disabled, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
    )
      .bind(staleOrganizationId, staleOrganizationId, 'Stale attempt Organization', now, now)
      .run()
    await env.DB.prepare(
      'INSERT INTO member (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind('member-attempt-stale', staleOrganizationId, owner!.userId, 'member', now, now)
      .run()

    const createResource = await harness.request('/api/resource-servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({
        identifier: 'attempt-resource',
        resourceUrl: resource,
        authorizationModel: 'native',
        ownerOrganizationId: platformOrganizationId,
        visibility: 'public',
      }),
    })
    expect(createResource.status, await createResource.clone().text()).toBe(201)
    const redirectUri = 'http://localhost/attempt-callback'
    const createApplication = async (consentRequired: boolean) => {
      const response = await harness.request('/api/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({
          name: consentRequired ? 'Attempt Consent App' : 'Attempt App',
          clientType: 'public_spa',
          redirectUris: [redirectUri],
          ownerOrganizationId: platformOrganizationId,
          visibility: 'public',
          consentRequired,
        }),
      })
      expect(response.status, await response.clone().text()).toBe(201)
      return (await response.json()) as { clientId: string }
    }
    const application = await createApplication(false)
    let attemptSequence = 0
    const startAttempt = async (clientId = application.clientId) => {
      attemptSequence += 1
      const verifier = `attempt-${attemptSequence}-verifier-0123456789abcdefghijklmnop`
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'openid',
        state: `attempt-${attemptSequence}`,
        code_challenge: await pkceChallenge(verifier),
        code_challenge_method: 'S256',
        resource,
      })
      const response = await harness.request(`/api/auth/oauth2/authorize?${params}`, {
        headers: { cookie: ownerCookie },
        redirect: 'manual',
      })
      expect(response.status).toBe(302)
      const location = new URL(response.headers.get('location') ?? '', baseURL)
      expect(location.pathname).toBe('/auth/context')
      return { oauthQuery: location.search.slice(1), verifier }
    }
    const postContinue = (cookie: string, oauthQuery: string, consentReferenceId: string) =>
      harness.request('/api/auth/oauth2/continue', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: baseURL },
        body: JSON.stringify({ postLogin: true, consentReferenceId, oauth_query: oauthQuery }),
      })

    const { oauthQuery: sessionBoundQuery } = await startAttempt()
    const wrongSession = await postContinue(otherCookie, sessionBoundQuery, `user:${owner!.userId}`)
    expect(wrongSession.status).toBe(403)
    await expect(wrongSession.json()).resolves.toMatchObject({ error: 'access_denied' })
    const originalSession = await postContinue(ownerCookie, sessionBoundQuery, `user:${owner!.userId}`)
    expect(originalSession.status, await originalSession.clone().text()).toBe(200)

    const { oauthQuery: contextBoundQuery } = await startAttempt()
    await env.DB.prepare('UPDATE organization SET disabled = 1 WHERE id = ?').bind(staleOrganizationId).run()
    const unavailableContext = await postContinue(ownerCookie, contextBoundQuery, `organization:${staleOrganizationId}`)
    expect(unavailableContext.status).toBe(403)
    await expect(unavailableContext.json()).resolves.toMatchObject({ error: 'access_denied' })
    const fallbackToUser = await postContinue(ownerCookie, contextBoundQuery, `user:${owner!.userId}`)
    expect(fallbackToUser.status, await fallbackToUser.clone().text()).toBe(200)
    const replay = await postContinue(ownerCookie, contextBoundQuery, `user:${owner!.userId}`)
    expect(replay.status).toBe(400)
    await expect(replay.json()).resolves.toMatchObject({ error: 'invalid_request' })

    const consentApplication = await createApplication(true)
    const consentAttempt = await startAttempt(consentApplication.clientId)
    const continueToConsent = await postContinue(
      ownerCookie,
      consentAttempt.oauthQuery,
      `organization:${platformOrganizationId}`,
    )
    expect(continueToConsent.status, await continueToConsent.clone().text()).toBe(200)
    const consentLocation = new URL(((await continueToConsent.json()) as { url: string }).url, baseURL)
    expect(consentLocation.pathname).toBe('/auth/consent')
    expect(consentLocation.searchParams.get('ba_ctx')).toBe('1')
    expect(consentLocation.searchParams.get('ba_ref')).toBe(`organization:${platformOrganizationId}`)
    expect(consentLocation.searchParams.has('ba_pl')).toBe(true)

    const tamperedQuery = new URLSearchParams(consentLocation.search.slice(1))
    tamperedQuery.set('ba_ref', `organization:${staleOrganizationId}`)
    const tamperedReference = await harness.request('/api/auth/oauth2/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie, origin: baseURL },
      body: JSON.stringify({ accept: true, oauth_query: tamperedQuery.toString() }),
    })
    expect(tamperedReference.status).toBe(400)
    await expect(tamperedReference.json()).resolves.toMatchObject({ error: 'invalid_signature' })

    const noReferenceParams = new URLSearchParams(consentLocation.search.slice(1))
    noReferenceParams.delete('ba_ref')
    const noReferenceQuery = await resignOAuthQuery(noReferenceParams.toString())
    const missingReference = await harness.request('/api/auth/oauth2/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie, origin: baseURL },
      body: JSON.stringify({ accept: true, oauth_query: noReferenceQuery }),
    })
    expect(missingReference.status).toBe(400)
    await expect(missingReference.json()).resolves.toMatchObject({ error: 'invalid_request' })

    const approveConsent = async (location: URL) => {
      const response = await harness.request('/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: ownerCookie, origin: baseURL },
        body: JSON.stringify({ accept: true, scope: 'openid', oauth_query: location.search.slice(1) }),
      })
      expect(response.status, await response.clone().text()).toBe(200)
      return new URL(((await response.json()) as { url: string }).url, baseURL)
    }
    const exchangeCode = async (callback: URL, verifier: string) => {
      const response = await harness.request('/api/auth/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: consentApplication.clientId,
          redirect_uri: redirectUri,
          code: callback.searchParams.get('code') ?? '',
          code_verifier: verifier,
          resource,
        }),
      })
      expect(response.status, await response.clone().text()).toBe(200)
      return (await response.json()) as { access_token: string; id_token: string }
    }

    const organizationTokens = await exchangeCode(await approveConsent(consentLocation), consentAttempt.verifier)
    expect(decodeJwtPayload(organizationTokens.access_token)[organizationClaim]).toBe(platformOrganizationId)
    expect(decodeJwtPayload(organizationTokens.id_token)[organizationClaim]).toBe(platformOrganizationId)

    const userConsentAttempt = await startAttempt(consentApplication.clientId)
    const continueUserConsent = await postContinue(ownerCookie, userConsentAttempt.oauthQuery, `user:${owner!.userId}`)
    expect(continueUserConsent.status, await continueUserConsent.clone().text()).toBe(200)
    const userConsentLocation = new URL(((await continueUserConsent.json()) as { url: string }).url, baseURL)
    expect(userConsentLocation.pathname).toBe('/auth/consent')
    expect(userConsentLocation.searchParams.get('ba_ref')).toBe(`user:${owner!.userId}`)
    const userTokens = await exchangeCode(await approveConsent(userConsentLocation), userConsentAttempt.verifier)
    expect(decodeJwtPayload(userTokens.access_token)).not.toHaveProperty(organizationClaim)
    expect(decodeJwtPayload(userTokens.id_token)).not.toHaveProperty(organizationClaim)
  })

  it('completes ordinary consent without a Realmroot Context marker when no Resource is requested', async () => {
    const cookie = await signInAdmin(harness)
    const redirectUri = 'http://localhost/ordinary-consent-callback'
    const createApplication = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Ordinary OIDC Consent App',
        clientType: 'public_spa',
        redirectUris: [redirectUri],
        ownerOrganizationId: platformOrganizationId,
        visibility: 'public',
        consentRequired: true,
      }),
    })
    expect(createApplication.status, await createApplication.clone().text()).toBe(201)
    const application = (await createApplication.json()) as { clientId: string }

    const verifier = 'ordinary-consent-verifier-0123456789abcdefghijklmnop'
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: application.clientId,
      redirect_uri: redirectUri,
      scope: 'openid',
      state: 'ordinary-consent-state',
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: 'S256',
    })
    const authorize = await harness.request(`/api/auth/oauth2/authorize?${params}`, {
      headers: { cookie },
      redirect: 'manual',
    })
    expect(authorize.status).toBe(302)
    const consentLocation = new URL(authorize.headers.get('location') ?? '', baseURL)
    expect(consentLocation.pathname).toBe('/auth/consent')
    expect(consentLocation.searchParams.has('ba_pl')).toBe(true)
    expect(consentLocation.searchParams.has('ba_ctx')).toBe(false)
    expect(consentLocation.searchParams.has('ba_ref')).toBe(false)

    const approve = await harness.request('/api/auth/oauth2/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: baseURL },
      body: JSON.stringify({ accept: true, scope: 'openid', oauth_query: consentLocation.search.slice(1) }),
    })
    expect(approve.status, await approve.clone().text()).toBe(200)
    const callback = new URL(((await approve.json()) as { url: string }).url, baseURL)
    expect(callback.pathname).toBe('/ordinary-consent-callback')
    expect(callback.searchParams.get('state')).toBe('ordinary-consent-state')

    const token = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: application.clientId,
        redirect_uri: redirectUri,
        code: callback.searchParams.get('code') ?? '',
        code_verifier: verifier,
      }),
    })
    expect(token.status, await token.clone().text()).toBe(200)
    const tokens = (await token.json()) as { access_token: string; id_token: string }
    expect(decodeJwtPayload(tokens.access_token)).not.toHaveProperty(organizationClaim)
    expect(decodeJwtPayload(tokens.id_token)).not.toHaveProperty(organizationClaim)
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

    const contextRedirect = await harness.request(`/api/auth/oauth2/authorize?${authorizeParams}`, {
      headers: { cookie },
      redirect: 'manual',
    })
    const callback = await continueOAuthContext(
      harness,
      cookie,
      contextRedirect,
      `organization:${platformOrganizationId}`,
    )
    const code = callback.searchParams.get('code')
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
    const admin = await env.DB.prepare('SELECT user_id AS userId FROM member WHERE organization_id = ? LIMIT 1')
      .bind(platformOrganizationId)
      .first<{ userId: string }>()
    expect(admin?.userId).toBeTruthy()
    await env.DB.prepare('INSERT INTO team (id, name, organization_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind('team-platform-admins', 'platform-admins', platformOrganizationId, Date.now(), Date.now())
      .run()
    await env.DB.prepare('INSERT INTO team_member (id, team_id, user_id, created_at) VALUES (?, ?, ?, ?)')
      .bind('team-member-platform-admin', 'team-platform-admins', admin!.userId, Date.now())
      .run()
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
      scope: 'openid profile email groups',
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
    const identityOnlyClaims = ['authorization', 'roles', 'application_id', 'organization_id']
    const idPayload = decodeJwtPayload(idToken)
    for (const claim of identityOnlyClaims) expect(idPayload).not.toHaveProperty(claim)
    expect(idPayload['urn:realmroot:params:oauth:org']).toBe(platformOrganizationId)
    expect(idPayload.groups).toEqual(['platform-admins'])
    expect(Number(idPayload.exp) - Number(idPayload.iat)).toBe(10 * 60)
    expect(idPayload).not.toHaveProperty('urn:realmroot:params:oauth:tenant')

    const userInfo = await harness.request('/api/auth/oauth2/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(userInfo.status, await userInfo.clone().text()).toBe(200)
    const userInfoBody = (await userInfo.json()) as Record<string, unknown>
    expect(userInfoBody).toMatchObject({ sub: idPayload.sub })
    for (const claim of [...identityOnlyClaims, 'groups']) expect(userInfoBody).not.toHaveProperty(claim)
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
