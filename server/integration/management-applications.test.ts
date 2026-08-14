import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { oauthClient, session } from '@server/db/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createUser, type Harness, platformOrganizationId, signIn, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

interface CreatedApplication {
  id: string
  clientId: string
  clientSecret?: string
  clientType: 'confidential_web' | 'public_spa' | 'public_native' | 'machine'
  redirectUris: string[]
  allowedGrantTypes: string[]
  oidcScopes: string[]
}

async function createApplication(
  harness: Harness,
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<CreatedApplication> {
  const response = await harness.request('/api/applications', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      name: 'Customer Portal',
      slug: 'customer-portal',
      clientType: 'confidential_web',
      redirectUris: ['http://localhost/callback'],
      ownerOrganizationId: platformOrganizationId,
      consentRequired: false,
      ...overrides,
    }),
  })
  expect(response.status, await response.clone().text()).toBe(201)
  return (await response.json()) as CreatedApplication
}

describe('applications management over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('rejects anonymous reads with 401', async () => {
    const response = await harness.request('/api/applications')
    expect(response.status).toBe(401)
  })

  it('returns an empty tenant-filtered collection to a user without Organization access', async () => {
    const adminCookie = await signInAdmin(harness)
    await createUser(harness, adminCookie, {
      email: 'member@example.com',
      username: 'member',
      displayName: 'Member',
      password: 'member-password-2026',
    })
    const memberCookie = await signIn(harness, 'member@example.com', 'member-password-2026')

    const response = await harness.request('/api/applications', { headers: { cookie: memberCookie } })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ items: [], pagination: { total: 0 } })
  })

  it('rejects an invalid create payload with 400', async () => {
    const cookie = await signInAdmin(harness)
    const response = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ slug: 'no-name' }),
    })
    expect(response.status).toBe(400)
  })

  it(`creates, reads, updates, and deletes an application through real SQL
      [spec: management-api/management-restish-oauth-crud]
      [spec: management-api/management-resource-identifiers]`, async () => {
    const cookie = await signInAdmin(harness)
    const created = await createApplication(harness, cookie)
    const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    expect(created.id).toMatch(uuidV7Pattern)
    expect(created.clientId).toMatch(uuidV7Pattern)
    const [authSession] = await harness.db.select({ id: session.id }).from(session).limit(1)
    const [clientRecord] = await harness.db.select({ id: oauthClient.id }).from(oauthClient).limit(1)
    expect(authSession?.id).toMatch(uuidV7Pattern)
    expect(clientRecord?.id).toMatch(uuidV7Pattern)

    const fetched = await harness.request(`/api/applications/${created.id}`, { headers: { cookie } })
    expect(fetched.status).toBe(200)
    const fetchedBody = (await fetched.json()) as { name: string }
    expect(fetchedBody.name).toBe('Customer Portal')

    const patched = await harness.request(`/api/applications/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Renamed Portal' }),
    })
    expect(patched.status).toBe(200)
    expect(((await patched.json()) as { name: string }).name).toBe('Renamed Portal')

    const removed = await harness.request(`/api/applications/${created.id}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(removed.status).toBe(204)

    const missing = await harness.request(`/api/applications/${created.id}`, { headers: { cookie } })
    expect(missing.status).toBe(404)
  })

  it('creates a fully derived machine Application through the Management API [spec: admin-console/admin-create-application]', async () => {
    const cookie = await signInAdmin(harness)
    const created = await createApplication(harness, cookie, {
      name: 'Event Publisher',
      slug: 'event-publisher',
      clientType: 'machine',
      redirectUris: [],
    })

    expect(created).toMatchObject({
      clientType: 'machine',
      redirectUris: [],
      allowedGrantTypes: ['client_credentials', 'urn:ietf:params:oauth:grant-type:token-exchange'],
      oidcScopes: [],
    })
    expect(created.clientSecret).toMatch(/^fas_/)

    const rejected = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Invalid machine',
        clientType: 'machine',
        redirectUris: ['https://machine.example.com/callback'],
        ownerOrganizationId: platformOrganizationId,
      }),
    })
    expect(rejected.status).toBe(400)
  })

  it('configures Native device login through the Management API [spec: admin-console/admin-create-application]', async () => {
    const cookie = await signInAdmin(harness)
    const created = await createApplication(harness, cookie, {
      name: 'Runner CLI',
      slug: 'runner-cli',
      clientType: 'public_native',
      redirectUris: ['com.example.runner:/callback'],
    })
    expect(created.allowedGrantTypes).toEqual(['authorization_code', 'refresh_token'])

    const enabled = await harness.request(`/api/applications/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ deviceLoginEnabled: true }),
    })
    expect(enabled.status, await enabled.clone().text()).toBe(200)
    expect(((await enabled.json()) as CreatedApplication).allowedGrantTypes).toEqual([
      'authorization_code',
      'refresh_token',
      'urn:ietf:params:oauth:grant-type:device_code',
    ])

    const deviceCode = await harness.request('/api/auth/device/code', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: created.clientId,
        scope: 'openid profile email offline_access',
      }),
    })
    expect(deviceCode.status, await deviceCode.clone().text()).toBe(200)
    await expect(deviceCode.json()).resolves.toMatchObject({
      device_code: expect.any(String),
      user_code: expect.any(String),
      verification_uri: expect.any(String),
      expires_in: expect.any(Number),
      interval: expect.any(Number),
    })

    const disabled = await harness.request(`/api/applications/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ deviceLoginEnabled: false }),
    })
    expect(disabled.status, await disabled.clone().text()).toBe(200)
    expect(((await disabled.json()) as CreatedApplication).allowedGrantTypes).toEqual([
      'authorization_code',
      'refresh_token',
    ])
  })

  it('lists, replaces, and re-reads redirect URIs', async () => {
    const cookie = await signInAdmin(harness)
    const created = await createApplication(harness, cookie)

    const list = await harness.request(`/api/applications/${created.id}/redirect-uris`, {
      headers: { cookie },
    })
    expect(list.status).toBe(200)
    expect(((await list.json()) as { items: string[] }).items).toEqual(['http://localhost/callback'])

    const replaced = await harness.request(`/api/applications/${created.id}/redirect-uris`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ redirectUris: ['http://localhost/a', 'http://localhost/b'] }),
    })
    expect(replaced.status).toBe(200)
    expect(((await replaced.json()) as { items: string[] }).items).toEqual(['http://localhost/a', 'http://localhost/b'])
  })

  it('persists every OIDC claim selection through real SQL [spec: admin-console/admin-application-oidc-claims]', async () => {
    const cookie = await signInAdmin(harness)
    const created = await createApplication(harness, cookie)
    const oidcClaims = {
      accessToken: { groups: true, scopes: true },
      idToken: { authorization: true, organizationId: true },
      userInfo: { groups: true, roles: true },
    }

    const updated = await harness.request(`/api/applications/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ oidcClaims }),
    })
    expect(updated.status, await updated.clone().text()).toBe(200)
    expect(((await updated.json()) as { oidcClaims: unknown }).oidcClaims).toEqual(oidcClaims)

    const reloaded = await harness.request(`/api/applications/${created.id}`, { headers: { cookie } })
    expect(reloaded.status, await reloaded.clone().text()).toBe(200)
    expect(((await reloaded.json()) as { oidcClaims: unknown }).oidcClaims).toEqual(oidcClaims)
  })

  it('lists and rotates client secrets', async () => {
    const cookie = await signInAdmin(harness)
    const created = await createApplication(harness, cookie)

    const before = await harness.request(`/api/applications/${created.id}/client-secrets`, {
      headers: { cookie },
    })
    expect(before.status).toBe(200)
    const beforeBody = (await before.json()) as { items: unknown[] }
    const beforeCount = beforeBody.items.length

    const rotated = await harness.request(`/api/applications/${created.id}/client-secrets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(rotated.status).toBe(201)
    expect(((await rotated.json()) as { clientSecret: string }).clientSecret).toBeTruthy()

    const after = await harness.request(`/api/applications/${created.id}/client-secrets`, {
      headers: { cookie },
    })
    expect(((await after.json()) as { items: unknown[] }).items.length).toBe(beforeCount + 1)
  })

  it('grants, loads, lists, and revokes a user consent through real SQL [spec: management-api/management-restish-oauth-crud]', async () => {
    const cookie = await signInAdmin(harness)
    const created = await createApplication(harness, cookie, {
      slug: 'consent-app',
      name: 'Consent App',
    })

    // loadConsentRequest reads the client + existing consent (findByClientId + findConsent).
    const loaded = await harness.request(
      `/api/account/application-authorization-request?client_id=${created.clientId}&redirect_uri=${encodeURIComponent('http://localhost/callback')}&scope=openid%20profile`,
      { headers: { cookie } },
    )
    expect(loaded.status, await loaded.clone().text()).toBe(200)
    expect(((await loaded.json()) as { existingConsent: unknown }).existingConsent).toBeNull()

    // createConsent writes applicationConsent + oauthConsent rows.
    const granted = await harness.request('/api/account/application-authorizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ clientId: created.clientId, resourceServerId: null, scopes: ['openid', 'profile'] }),
    })
    expect(granted.status, await granted.clone().text()).toBe(201)
    const grantedBody = (await granted.json()) as { consent: { id: string } }
    const consentId = grantedBody.consent.id

    const regranted = await harness.request('/api/account/application-authorizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ clientId: created.clientId, resourceServerId: null, scopes: ['openid'] }),
    })
    expect(regranted.status, await regranted.clone().text()).toBe(201)
    expect(((await regranted.json()) as { consent: { id: string } }).consent.id).toBe(consentId)

    const apps = await harness.request('/api/account/application-authorizations', { headers: { cookie } })
    expect(apps.status).toBe(200)
    const appsBody = (await apps.json()) as { items: Array<{ id: string }> }
    expect(appsBody.items.filter((item) => item.id === consentId)).toHaveLength(1)

    const managed = await harness.request(`/api/applications/${created.id}/authorizations?status=active`, {
      headers: { cookie },
    })
    expect(managed.status, await managed.clone().text()).toBe(200)
    await expect(managed.json()).resolves.toMatchObject({
      items: [{ id: consentId, scopes: ['openid', 'profile'], user: { email: 'admin@example.com' } }],
      pagination: { total: 1 },
    })
    const revoked = await harness.request(`/api/account/application-authorizations/${consentId}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(revoked.status).toBe(204)

    const repeatedRevocation = await harness.request(`/api/account/application-authorizations/${consentId}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(repeatedRevocation.status).toBe(204)

    const grantedAgain = await harness.request('/api/account/application-authorizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ clientId: created.clientId, resourceServerId: null, scopes: ['openid'] }),
    })
    expect(grantedAgain.status, await grantedAgain.clone().text()).toBe(201)
    const managedConsentId = ((await grantedAgain.json()) as { consent: { id: string } }).consent.id

    const managedRevocation = await harness.request(
      `/api/applications/${created.id}/authorizations/${managedConsentId}`,
      {
        method: 'DELETE',
        headers: { cookie },
      },
    )
    expect(managedRevocation.status).toBe(204)
    const revokedAuthorization = await harness.request(
      `/api/applications/${created.id}/authorizations/${managedConsentId}`,
      {
        headers: { cookie },
      },
    )
    await expect(revokedAuthorization.json()).resolves.toMatchObject({ id: managedConsentId, status: 'revoked' })
    const afterManagedRevocation = await harness.request(
      `/api/applications/${created.id}/authorizations?status=active`,
      { headers: { cookie } },
    )
    await expect(afterManagedRevocation.json()).resolves.toMatchObject({
      items: [],
      pagination: { total: 0 },
    })
  })
})
