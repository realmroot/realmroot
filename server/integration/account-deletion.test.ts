import { applyD1Migrations, env, reset } from 'cloudflare:test'
import {
  agentIdentity,
  apiResource,
  identityProviderConnector,
  member,
  organization,
  providerConnection,
  providerCredential,
  providerResourceAuthorization,
  session,
  user,
} from '@server/db/schema'
import { processAccountDeletionCleanup } from '@server/usecases/account-deletion'
import { uploadAsset } from '@server/usecases/assets'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { baseURL, createHarness, createUser, platformOrganizationId, signIn, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

async function setup() {
  const h = await createHarness()
  const adminCookie = await signInAdmin(h)
  const userId = await createUser(h, adminCookie, {
    email: 'erase@example.com',
    username: 'erase-me',
    displayName: 'Erase Me',
    password: 'erase-password-2026',
  })
  const cookie = await signIn(h, 'erase@example.com', 'erase-password-2026')
  const remove = (
    body: unknown = { confirmation: 'DELETE' },
    headers = { cookie, origin: baseURL, platformOrganizationId },
  ) =>
    h.request('/api/account', {
      method: 'DELETE',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  return { h, userId, cookie, adminCookie, remove }
}

describe('permanent account deletion', () => {
  it('erases credentials, keeps immutable tombstones and rejects old sessions [spec: account-center/permanent-account-deletion]', async () => {
    const { h, userId, cookie, adminCookie, remove } = await setup()
    const now = new Date()
    await h.db.insert(agentIdentity).values({
      id: 'erase-agent',
      issuer: baseURL,
      subject: 'stable-agent',
      name: 'Private name',
      username: 'private-agent',
      ownerUserId: userId,
      createdAt: now,
      updatedAt: now,
    })
    const response = await remove()
    expect(response.status, await response.clone().text()).toBe(202)
    const [tombstone] = await h.db.select().from(user).where(eq(user.id, userId))
    expect(tombstone.deletedAt).toBeInstanceOf(Date)
    expect(tombstone.email).not.toBe('erase@example.com')
    expect(tombstone.username).toBeNull()
    await expect(
      env.DB.prepare(
        "INSERT INTO session (id,token,user_id,expires_at,created_at,updated_at) VALUES ('late-session','late-token',?,?,?,?)",
      )
        .bind(userId, Date.now() + 60_000, Date.now(), Date.now())
        .run(),
    ).rejects.toThrow('account_deleted')
    await expect(
      env.DB.prepare(
        "INSERT INTO resource_scope_entitlement (id,user_id,resource_server_id,scope,mode,authorization_context_hash,granted_by_user_id,created_at,updated_at) SELECT 'late-grant',?1,id,'users:read','persistent','late-context',?1,?2,?2 FROM api_resource LIMIT 1",
      )
        .bind(userId, Date.now())
        .run(),
    ).rejects.toThrow('account_deleted')
    expect(tombstone.name).toBe('Deleted user')
    expect(await h.db.select().from(session).where(eq(session.userId, userId))).toEqual([])
    for (const table of ['account', 'passkey', 'two_factor', 'member', 'user_profile']) {
      expect(await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`).bind(userId).first('n')).toBe(
        0,
      )
    }
    const [identity] = await h.db.select().from(agentIdentity).where(eq(agentIdentity.id, 'erase-agent'))
    expect(identity.deletedAt).toBeInstanceOf(Date)
    expect(identity.name).toBe('Deleted agent')
    expect((await h.request('/api/account/profile', { headers: { cookie } })).status).toBe(401)
    expect(await (await h.request('/api/auth/get-session', { headers: { cookie } })).json()).toBeNull()
    expect(
      (
        await h.request('/api/auth/update-user', {
          method: 'POST',
          headers: { cookie, origin: baseURL, 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Restored' }),
        })
      ).status,
    ).toBeGreaterThanOrEqual(400)
    await expect(h.db.update(user).set({ name: 'Restored' }).where(eq(user.id, userId))).rejects.toThrow()
    expect((await h.request(`/api/users/${userId}`, { headers: { cookie: adminCookie } })).status).toBe(404)
    const replacement = await createUser(h, adminCookie, {
      email: 'erase@example.com',
      username: 'erase-me',
      displayName: 'New User',
      password: 'new-password-2026',
    })
    expect(replacement).not.toBe(userId)
    expect(await h.db.select().from(member).where(eq(member.userId, replacement))).toEqual([])
  })

  it('requires explicit confirmation and a recent non-impersonated browser session', async () => {
    const { h, userId, remove } = await setup()
    expect((await remove({}, { cookie: '', origin: baseURL, platformOrganizationId })).status).toBe(401)
    expect((await remove({ confirmation: 'no' })).status).toBe(400)
    await h.db
      .update(session)
      .set({ createdAt: new Date(Date.now() - 600_000) })
      .where(eq(session.userId, userId))
    expect((await remove()).status).toBe(403)
    expect((await h.db.select().from(user).where(eq(user.id, userId)))[0].deletedAt).toBeNull()
  })

  it('protects the last owner atomically and lets deletion proceed after transfer', async () => {
    const { h, userId, remove } = await setup()
    const now = new Date()
    await h.db
      .insert(organization)
      .values({ id: 'owned-org', name: 'Owned', slug: 'owned', createdAt: now, updatedAt: now })
    await h.db.insert(member).values({
      id: 'owner-member',
      organizationId: 'owned-org',
      userId,
      role: 'owner',
      createdAt: now,
      updatedAt: now,
    })
    expect((await remove()).status).toBe(409)
    expect((await h.db.select().from(session).where(eq(session.userId, userId))).length).toBe(1)
    expect(await env.DB.prepare('SELECT count(*) AS n FROM account_deletion_cleanup').first('n')).toBe(0)
    await h.db.delete(member).where(eq(member.id, 'owner-member'))
    expect((await remove()).status).toBe(202)
  })

  it('retains durable cleanup on storage failure and removes it after success [spec: account-center/account-deletion-cleanup]', async () => {
    const { h, userId, remove } = await setup()
    await env.DB.prepare(
      "INSERT INTO uploaded_asset (id,purpose,storage_key,content_type,byte_size,created_by_user_id,created_at) VALUES ('avatar','avatar','private/avatar.png','image/png',10,?,?)",
    )
      .bind(userId, Date.now())
      .run()
    expect((await remove()).status).toBe(202)
    h.deps.assetStorage.delete = vi.fn().mockRejectedValue(new Error('storage unavailable'))
    await expect(processAccountDeletionCleanup(h.deps)).rejects.toThrow('durable retries')
    expect(
      await env.DB.prepare('SELECT attempts FROM account_deletion_cleanup WHERE user_id = ?')
        .bind(userId)
        .first('attempts'),
    ).toBe(1)
    h.deps.assetStorage.delete = vi.fn().mockResolvedValue(undefined)
    await env.DB.prepare('UPDATE account_deletion_cleanup SET next_attempt_at = 0').run()
    await processAccountDeletionCleanup(h.deps)
    expect(h.deps.assetStorage.delete).toHaveBeenCalledWith('private/avatar.png')
    expect(await env.DB.prepare('SELECT count(*) AS n FROM account_deletion_cleanup').first('n')).toBe(0)
  })

  it('administrator deletion follows the same lifecycle', async () => {
    const { h, userId, cookie, adminCookie } = await setup()
    const response = await h.request(`/api/users/${userId}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie, origin: baseURL, platformOrganizationId },
    })
    expect(response.status, await response.clone().text()).toBe(204)
    expect((await h.db.select().from(user).where(eq(user.id, userId)))[0].deletedAt).toBeInstanceOf(Date)
    expect((await h.request('/api/account/profile', { headers: { cookie } })).status).toBe(401)
  })
  it('revokes provider tokens through the real gateway and scrubs credentials only after success', async () => {
    const { h, userId, remove } = await setup()
    const now = new Date()
    const issuer = 'https://deletion-provider.example.com'
    await h.db.insert(identityProviderConnector).values({
      id: 'delete-connector',
      slug: 'delete-connector',
      providerType: 'generic_oauth',
      providerId: 'delete-provider',
      displayName: 'Delete Provider',
      enabled: true,
      resourceAuthorizationEnabled: true,
      resourceClientId: 'client',
      resourceClientSecret: await h.deps.secrets.seal('client-secret', 'delete-client-secret'),
      resourceClientSecretContext: 'delete-client-secret',
      resourceIssuer: issuer,
      resourceAuthorizationEndpoint: `${issuer}/authorize`,
      resourceTokenEndpoint: `${issuer}/token`,
      resourceUserInfoEndpoint: `${issuer}/userinfo`,
      resourceJwksEndpoint: `${issuer}/jwks`,
      resourceRevocationEndpoint: `${issuer}/revoke`,
      createdAt: now,
      updatedAt: now,
    })
    await h.db.insert(apiResource).values({
      id: 'delete-resource',
      identifier: 'delete-resource',
      name: 'Delete Resource',
      resourceUrl: `${issuer}/api`,
      authorizationModel: 'external',
      connectorId: 'delete-connector',
      ownerOrganizationId: platformOrganizationId,
      createdAt: now,
      updatedAt: now,
    })
    await h.db.insert(providerConnection).values({
      id: 'delete-provider-connection',
      connectorId: 'delete-connector',
      ownerUserId: userId,
      externalSubject: 'private@example.com',
      displayName: 'Private Account',
      createdAt: now,
      updatedAt: now,
    })
    await h.db.insert(providerResourceAuthorization).values({
      id: 'delete-authorization',
      providerConnectionId: 'delete-provider-connection',
      resourceId: 'delete-resource',
      createdAt: now,
      updatedAt: now,
    })
    await h.db.insert(providerCredential).values({
      id: 'delete-credential',
      providerResourceAuthorizationId: 'delete-authorization',
      encryptedTokens: await h.deps.secrets.seal(
        JSON.stringify({ refreshToken: 'private-refresh', accessToken: 'private-access' }),
        'provider-credential:delete-credential:tokens',
      ),
      grantedScopes: [],
      createdAt: now,
      updatedAt: now,
    })
    expect((await remove()).status).toBe(202)
    expect((await h.db.select().from(providerCredential))[0].status).toBe('revoked')
    h.deps.externalHttp.fetch = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }))
    await expect(processAccountDeletionCleanup(h.deps)).rejects.toThrow('durable retries')
    expect((await h.db.select().from(providerCredential))[0].encryptedTokens).not.toBe('')
    const sent: string[] = []
    h.deps.externalHttp.fetch = vi.fn(async (request) => {
      expect(request.url).toBe(`${issuer}/revoke`)
      sent.push(await request.text())
      return new Response(null, { status: 200 })
    })
    await env.DB.prepare('UPDATE account_deletion_cleanup SET next_attempt_at = 0').run()
    await processAccountDeletionCleanup(h.deps)
    expect(sent.some((body) => body.includes('token=private-refresh'))).toBe(true)
    expect(sent.some((body) => body.includes('token=private-access'))).toBe(true)
    expect((await h.db.select().from(providerCredential))[0].encryptedTokens).toBe('')
    expect((await h.db.select().from(providerConnection))[0].externalSubject).toBe('')
  })

  it('rejects issued OAuth JWTs, userinfo and refresh tokens after deletion', async () => {
    const { h, cookie, adminCookie, remove } = await setup()
    const created = await h.request('/api/applications', {
      method: 'POST',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Deletion client',
        slug: 'deletion-client',
        clientType: 'confidential_web',
        redirectUris: [`${baseURL}/callback`],
        ownerOrganizationId: platformOrganizationId,
        visibility: 'public',
        consentRequired: false,
      }),
    })
    expect(created.status, await created.clone().text()).toBe(201)
    const client = (await created.json()) as { clientId: string; clientSecret: string }
    const verifier = 'deletion-flow-pkce-verifier-0123456789abcdefghijklmnop'
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
    const challenge = btoa(String.fromCharCode(...digest))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: client.clientId,
      redirect_uri: `${baseURL}/callback`,
      scope: 'openid profile email offline_access',
      state: 'delete-state',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    const authorized = await h.request(`/api/auth/oauth2/authorize?${params}`, {
      headers: { cookie },
      redirect: 'manual',
    })
    expect(authorized.status, await authorized.clone().text()).toBe(302)
    const code = new URL(authorized.headers.get('location')!, baseURL).searchParams.get('code')
    expect(code).toBeTruthy()
    const headers = {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`,
    }
    const token = await h.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers,
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        redirect_uri: `${baseURL}/callback`,
        code: code!,
        code_verifier: verifier,
      }),
    })
    expect(token.status, await token.clone().text()).toBe(200)
    const tokens = (await token.json()) as { access_token: string; refresh_token: string }
    const introspect = () =>
      h.request('/api/auth/oauth2/introspect', {
        method: 'POST',
        headers,
        body: new URLSearchParams({ token: tokens.access_token }),
      })
    expect(await (await introspect()).json()).toMatchObject({ active: true })
    expect(
      (await h.request('/api/auth/oauth2/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } }))
        .status,
    ).toBe(200)
    expect((await remove()).status).toBe(202)
    expect(await (await introspect()).json()).toMatchObject({ active: false })
    expect(
      (await h.request('/api/auth/oauth2/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } }))
        .status,
    ).toBeGreaterThanOrEqual(400)
    expect(
      (
        await h.request('/api/auth/oauth2/token', {
          method: 'POST',
          headers,
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
        })
      ).status,
    ).toBeGreaterThanOrEqual(400)
  })
  it('serializes concurrent last-owner deletions and does not create an ownerless organization', async () => {
    const { h, userId, adminCookie } = await setup()
    const other = await createUser(h, adminCookie, {
      email: 'other-owner@example.com',
      username: 'other-owner',
      displayName: 'Other Owner',
      password: 'other-password-2026',
    })
    const now = new Date()
    await h.db
      .insert(organization)
      .values({ id: 'concurrent-org', name: 'Concurrent', slug: 'concurrent', createdAt: now, updatedAt: now })
    await h.db.insert(member).values(
      [userId, other].map((id, index) => ({
        id: `concurrent-member-${index}`,
        organizationId: 'concurrent-org',
        userId: id,
        role: 'owner',
        createdAt: now,
        updatedAt: now,
      })),
    )
    const results = await Promise.allSettled([userId, other].map((id) => h.deps.accountDeletion.erase(id, Date.now())))
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await h.db.select().from(member).where(eq(member.organizationId, 'concurrent-org'))).toHaveLength(1)
  })

  it('reclaims abandoned cleanup jobs without letting stale workers finish the new claim', async () => {
    const { h, remove } = await setup()
    await remove()
    const now = Date.now()
    const first = await h.deps.accountDeletion.claim(now, 'first')
    expect(first).not.toBeNull()
    expect(await h.deps.accountDeletion.claim(now, 'second')).toBeNull()
    const recovered = await h.deps.accountDeletion.claim(now + 300_001, 'recovered')
    expect(recovered?.claimId).toBe('recovered')
    await h.deps.accountDeletion.finish(first!)
    expect(await env.DB.prepare('SELECT claim_id FROM account_deletion_cleanup').first('claim_id')).toBe('recovered')
  })

  it('queues an in-flight avatar upload if deletion wins and immediate file cleanup fails', async () => {
    const { h, userId, remove } = await setup()
    await remove()
    const originalDelete = h.deps.assetStorage.delete
    h.deps.assetStorage.delete = vi.fn().mockRejectedValue(new Error('R2 unavailable'))
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer],
      'personal-name.png',
      { type: 'image/png' },
    )
    await expect(uploadAsset(h.deps, { purpose: 'avatar', file, actorUserId: userId })).rejects.toThrow()
    const keys = JSON.parse(
      (await env.DB.prepare('SELECT asset_keys FROM account_deletion_cleanup WHERE user_id = ?')
        .bind(userId)
        .first<string>('asset_keys'))!,
    ) as string[]
    expect(keys).toHaveLength(1)
    expect(await h.deps.assetStorage.get(keys[0])).not.toBeNull()
    h.deps.assetStorage.delete = originalDelete
    await processAccountDeletionCleanup(h.deps)
    expect(await h.deps.assetStorage.get(keys[0])).toBeNull()
  })

  it('invalidates old email verification links when the same email registers a new identity', async () => {
    const { h, cookie, adminCookie, remove } = await setup()
    const send = () =>
      h.request('/api/auth/send-verification-email', {
        method: 'POST',
        headers: { cookie, origin: baseURL, 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'erase@example.com' }),
      })
    expect((await send()).status).toBe(200)
    const oldLink = h.sentEmails.at(-1)?.text?.match(/https?:\/\/[^\s]+\/verify-email\?[^\s]+/)?.[0]
    expect(oldLink).toBeTruthy()
    expect((await remove()).status).toBe(202)
    const replacement = await createUser(h, adminCookie, {
      email: 'erase@example.com',
      username: 'replacement',
      displayName: 'Replacement',
      password: 'replacement-password-2026',
    })
    expect((await h.request(oldLink!)).status).toBe(401)
    expect((await h.db.select().from(user).where(eq(user.id, replacement)))[0].emailVerified).toBe(false)
    const newCookie = await signIn(h, 'erase@example.com', 'replacement-password-2026')
    expect(
      (
        await h.request('/api/auth/send-verification-email', {
          method: 'POST',
          headers: { cookie: newCookie, origin: baseURL, 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'erase@example.com' }),
        })
      ).status,
    ).toBe(200)
    const newLink = h.sentEmails.at(-1)?.text?.match(/https?:\/\/[^\s]+\/verify-email\?[^\s]+/)?.[0]
    expect(newLink).toBeTruthy()
    expect((await h.request(newLink!)).status).toBeLessThan(400)
    expect((await h.db.select().from(user).where(eq(user.id, replacement)))[0].emailVerified).toBe(true)
  })
})
