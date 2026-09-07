import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { createRefreshAuthorizationPersistence } from '@server/adapters/repos/application-sessions'
import { oauthRefreshToken, session } from '@server/db/schema'
import { applicationSessionsResponseSchema } from '@shared/api/application-sessions'
import { eq } from 'drizzle-orm'
import { createLocalJWKSet, jwtVerify } from 'jose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  baseURL,
  createHarness,
  createUser,
  type Harness,
  platformOrganizationId,
  signIn,
  signInAdmin,
} from './harness'

const redirectUri = 'com.example.sessions:/callback'
const verifier = 'application-sessions-pkce-verifier-0123456789abcdefghijklmnop'
type Tokens = { access_token: string; refresh_token: string; expires_in: number }

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

describe('Application login session authorization over real D1', () => {
  let h: Harness
  let cookie: string
  let clientId: string
  beforeEach(async () => {
    h = await createHarness()
    cookie = await signInAdmin(h)
    clientId = await application('Session App')
  })
  async function application(name: string) {
    const response = await h.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name,
        clientType: 'public_native',
        redirectUris: [redirectUri],
        ownerOrganizationId: platformOrganizationId,
        visibility: 'public',
        consentRequired: false,
      }),
    })
    expect(response.status, await response.clone().text()).toBe(201)
    return ((await response.json()) as { clientId: string }).clientId
  }
  async function login(target = clientId, browserCookie = cookie): Promise<Tokens> {
    const challenge = btoa(
      String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))),
    )
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')
    const authorization = await h.request(
      `/api/auth/oauth2/authorize?${new URLSearchParams({
        client_id: target,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: 'openid offline_access',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`,
      { headers: { cookie: browserCookie }, redirect: 'manual' },
    )
    expect(authorization.status, await authorization.clone().text()).toBe(302)
    const code = new URL(authorization.headers.get('location')!).searchParams.get('code')
    expect(code, authorization.headers.get('location')!).toBeTruthy()
    const response = await token({
      grant_type: 'authorization_code',
      client_id: target,
      code: code!,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    })
    expect(response.status, await response.clone().text()).toBe(200)
    return response.json()
  }
  function token(body: Record<string, string>) {
    return h.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'ExampleApp/1.0 (Android)' },
      body: new URLSearchParams(body),
    })
  }
  function refresh(refreshToken: string, target = clientId) {
    return token({ grant_type: 'refresh_token', client_id: target, refresh_token: refreshToken })
  }
  async function list(target = clientId, browserCookie = cookie, query = '') {
    const response = await h.request(`/api/account/application-sessions?client_id=${target}${query}`, {
      headers: { cookie: browserCookie },
    })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    return applicationSessionsResponseSchema.parse(await response.json())
  }
  function remove(id: string, target = clientId, browserCookie = cookie, origin = baseURL) {
    return h.request(`/api/account/application-sessions/${id}?client_id=${target}`, {
      method: 'DELETE',
      headers: { cookie: browserCookie, origin },
    })
  }

  it('[spec: account-center/application-session-lifecycle] isolates applications and owners, preserves rotation identity, and revokes the whole chain', async () => {
    const first = await login()
    const oldestId = (await list()).items[0]!.id
    const second = await login()
    const otherClient = await application('Other App')
    const other = await login(otherClient)
    await createUser(h, cookie, {
      email: 'other@example.com',
      username: 'other',
      displayName: 'Other',
      password: 'other-password-2026',
    })
    const otherCookie = await signIn(h, 'other@example.com', 'other-password-2026')
    const otherUser = await login(clientId, otherCookie)
    const initial = await list()
    expect(initial.application).toEqual({ clientId, name: 'Session App' })
    expect(initial.pagination.totalItems).toBe(2)
    expect(initial.items.every((item) => item.userAgent === 'ExampleApp/1.0 (Android)' && !item.legacy)).toBe(true)
    const rotatedResponse = await refresh(first.refresh_token)
    expect(rotatedResponse.status, await rotatedResponse.clone().text()).toBe(200)
    const rotated = (await rotatedResponse.json()) as Tokens
    expect(new Set((await list()).items.map((item) => item.id))).toEqual(new Set(initial.items.map((item) => item.id)))
    expect((await refresh(first.refresh_token)).status).toBe(400)
    expect((await remove(oldestId, clientId, otherCookie)).status).toBe(404)
    expect((await remove(oldestId, otherClient)).status).toBe(404)
    expect((await remove(oldestId, clientId, cookie, 'https://untrusted.example')).status).toBe(403)
    expect((await remove(oldestId)).status).toBe(204)
    expect((await remove(oldestId)).status).toBe(204)
    expect((await refresh(rotated.refresh_token)).status).toBe(400)
    expect((await refresh(second.refresh_token)).status).toBe(200)
    expect((await refresh(other.refresh_token, otherClient)).status).toBe(200)
    expect((await refresh(otherUser.refresh_token)).status).toBe(200)
    expect((await list()).pagination.totalItems).toBe(1)
    expect((await list(clientId, otherCookie)).pagination.totalItems).toBe(1)
  })

  it('rejects missing authentication and invalid selectors and paginates active logins', async () => {
    expect((await h.request(`/api/account/application-sessions?client_id=${clientId}`)).status).toBe(401)
    expect((await h.request('/api/account/application-sessions', { headers: { cookie } })).status).toBe(400)
    expect(
      (await h.request('/api/account/application-sessions?client_id=unknown', { headers: { cookie } })).status,
    ).toBe(404)
    await login()
    await login()
    const first = await list(clientId, cookie, '&pageSize=1&page=1')
    const second = await list(clientId, cookie, '&pageSize=1&page=2')
    expect(first.pagination).toMatchObject({ totalItems: 2, totalPages: 2 })
    expect(first.items[0]!.id).not.toBe(second.items[0]!.id)
    await h.db.update(oauthRefreshToken).set({ expiresAt: new Date(Date.now() - 1) })
    expect((await list()).pagination.totalItems).toBe(0)
  })

  it('keeps application authorization after browser session deletion and expires access JWTs at the documented time', async () => {
    const tokens = await login()
    const [{ id }] = (await list()).items
    await h.db.delete(session)
    expect((await refresh(tokens.refresh_token)).status).toBe(200)
    cookie = await signIn(h, 'admin@example.com', 'admin-password-2026')
    expect((await list()).items[0]!.id).toBe(id)
    expect((await remove(id)).status).toBe(204)
    const jwks = createLocalJWKSet(await (await h.request('/api/auth/jwks')).json())
    const { payload } = await jwtVerify(tokens.access_token, jwks, {
      issuer: `${baseURL}/api/auth`,
      audience: `${baseURL}/api/auth/oauth2/userinfo`,
    })
    expect(tokens.expires_in).toBe(3600)
    expect(payload.exp! - payload.iat!).toBe(3600)
    await expect(
      jwtVerify(tokens.access_token, jwks, { currentDate: new Date(payload.exp! * 1000) }),
    ).rejects.toMatchObject({ code: 'ERR_JWT_EXPIRED' })
  })

  it('standard revocation with a rotated token revokes only its own login lifecycle', async () => {
    const first = await login()
    const second = await login()
    const rotated = (await (await refresh(first.refresh_token)).json()) as Tokens
    const revoke = await h.request('/api/auth/oauth2/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, token: first.refresh_token, token_type_hint: 'refresh_token' }),
    })
    expect(revoke.status, await revoke.clone().text()).toBe(200)
    expect((await refresh(rotated.refresh_token)).status).toBe(400)
    expect((await refresh(second.refresh_token)).status).toBe(200)
    expect((await list()).pagination.totalItems).toBe(1)
  })

  it('serializes concurrent rotation and revocation, including an already-read stale refresh', async () => {
    const first = await login()
    const concurrent = await Promise.all([refresh(first.refresh_token), refresh(first.refresh_token)])
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 400])
    const rotated = (await concurrent.find((response) => response.status === 200)!.json()) as Tokens
    const [{ id }] = (await list()).items
    const raced = await Promise.all([refresh(rotated.refresh_token), remove(id)])
    expect(raced[1]!.status).toBe(204)
    expect([200, 400]).toContain(raced[0]!.status)
    if (raced[0]!.status === 200) {
      const result = (await raced[0]!.json()) as Tokens
      expect((await refresh(result.refresh_token)).status).toBe(400)
    }
    expect((await refresh(rotated.refresh_token)).status).toBe(400)
    expect((await list()).pagination.totalItems).toBe(0)

    // Force the interleaving where the provider read the token before removal,
    // but its persistence call happens after removal committed.
    const fresh = await login()
    expect(fresh.refresh_token).toBeTruthy()
    const [{ id: freshId }] = (await list()).items
    const [stored] = await h.db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.id, freshId))
    await remove(freshId)
    const persistence = createRefreshAuthorizationPersistence(h.db, h.deps.ids)
    expect(
      await persistence.persist(
        {
          ...stored!,
          token: 'stale-refresh-result',
          scopes: JSON.parse(stored!.scopes),
          resources: JSON.parse(stored!.resources!),
        },
        freshId,
      ),
    ).toBeNull()
    expect((await list()).pagination.totalItems).toBe(0)
    expect((await login()).refresh_token).toBeTruthy()
    expect((await list()).pagination.totalItems).toBe(1)
  })
})
