import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createUser, type Harness, signIn, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

interface CreatedApplication {
  id: string
  clientId: string
  redirectUris: string[]
}

async function createApplication(
  harness: Harness,
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<CreatedApplication> {
  const response = await harness.request('/api/management/applications', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      name: 'Customer Portal',
      slug: 'customer-portal',
      clientType: 'confidential_web',
      redirectUris: ['http://localhost/callback'],
      firstParty: true,
      trusted: true,
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
    const response = await harness.request('/api/management/applications')
    expect(response.status).toBe(401)
  })

  it('rejects a signed-in non-admin with 403', async () => {
    const adminCookie = await signInAdmin(harness)
    await createUser(harness, adminCookie, {
      email: 'member@example.com',
      username: 'member',
      displayName: 'Member',
      password: 'member-password-2026',
    })
    const memberCookie = await signIn(harness, 'member@example.com', 'member-password-2026')

    const response = await harness.request('/api/management/applications', { headers: { cookie: memberCookie } })
    expect(response.status).toBe(403)
  })

  it('rejects an invalid create payload with 400', async () => {
    const cookie = await signInAdmin(harness)
    const response = await harness.request('/api/management/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ slug: 'no-name' }),
    })
    expect(response.status).toBe(400)
  })

  it('creates, reads, updates, and deletes an application through real SQL [spec: management-api/management-restish-oauth-crud]', async () => {
    const cookie = await signInAdmin(harness)
    const created = await createApplication(harness, cookie)

    const fetched = await harness.request(`/api/management/applications/${created.id}`, { headers: { cookie } })
    expect(fetched.status).toBe(200)
    const fetchedBody = (await fetched.json()) as { name: string }
    expect(fetchedBody.name).toBe('Customer Portal')

    const patched = await harness.request(`/api/management/applications/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Renamed Portal' }),
    })
    expect(patched.status).toBe(200)
    expect(((await patched.json()) as { name: string }).name).toBe('Renamed Portal')

    const removed = await harness.request(`/api/management/applications/${created.id}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(removed.status).toBe(204)

    const missing = await harness.request(`/api/management/applications/${created.id}`, { headers: { cookie } })
    expect(missing.status).toBe(404)
  })

  it('lists, replaces, and re-reads redirect URIs', async () => {
    const cookie = await signInAdmin(harness)
    const created = await createApplication(harness, cookie)

    const list = await harness.request(`/api/management/applications/${created.id}/redirect-uris`, {
      headers: { cookie },
    })
    expect(list.status).toBe(200)
    expect(((await list.json()) as { redirectUris: string[] }).redirectUris).toEqual(['http://localhost/callback'])

    const replaced = await harness.request(`/api/management/applications/${created.id}/redirect-uris`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ redirectUris: ['http://localhost/a', 'http://localhost/b'] }),
    })
    expect(replaced.status).toBe(200)
    expect(((await replaced.json()) as { redirectUris: string[] }).redirectUris).toEqual([
      'http://localhost/a',
      'http://localhost/b',
    ])
  })

  it('lists and rotates client secrets', async () => {
    const cookie = await signInAdmin(harness)
    const created = await createApplication(harness, cookie)

    const before = await harness.request(`/api/management/applications/${created.id}/client-secrets`, {
      headers: { cookie },
    })
    expect(before.status).toBe(200)
    const beforeBody = (await before.json()) as { secrets: unknown[] }
    const beforeCount = beforeBody.secrets.length

    const rotated = await harness.request(`/api/management/applications/${created.id}/client-secrets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(rotated.status).toBe(201)
    expect(((await rotated.json()) as { clientSecret: string }).clientSecret).toBeTruthy()

    const after = await harness.request(`/api/management/applications/${created.id}/client-secrets`, {
      headers: { cookie },
    })
    expect(((await after.json()) as { secrets: unknown[] }).secrets.length).toBe(beforeCount + 1)
  })

  it('grants, loads, lists, and revokes a user consent through real SQL', async () => {
    const cookie = await signInAdmin(harness)
    const created = await createApplication(harness, cookie, {
      slug: 'consent-app',
      name: 'Consent App',
      allowedScopes: ['openid', 'profile'],
    })

    // loadConsentRequest reads the client + existing consent (findByClientId + findConsent).
    const loaded = await harness.request(
      `/api/oauth/consent?client_id=${created.clientId}&redirect_uri=${encodeURIComponent('http://localhost/callback')}&scope=openid%20profile`,
      { headers: { cookie } },
    )
    expect(loaded.status, await loaded.clone().text()).toBe(200)
    expect(((await loaded.json()) as { existingConsent: unknown }).existingConsent).toBeNull()

    // createConsent writes applicationConsent + oauthConsent rows.
    const granted = await harness.request('/api/oauth/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ clientId: created.clientId, scopes: ['openid', 'profile'] }),
    })
    expect(granted.status, await granted.clone().text()).toBe(201)
    const grantedBody = (await granted.json()) as { consent: { id: string } }
    const consentId = grantedBody.consent.id

    // listConsentedApplications joins applicationConsent + application.
    const apps = await harness.request('/api/account/applications', { headers: { cookie } })
    expect(apps.status).toBe(200)
    const appsBody = (await apps.json()) as { applications: Array<{ id: string }> }
    expect(appsBody.applications.length).toBeGreaterThanOrEqual(1)

    // revokeConsent updates applicationConsent + clears oauth grant rows.
    const revoked = await harness.request(`/api/account/applications/${consentId}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(revoked.status).toBe(204)

    const revokeMissing = await harness.request(`/api/account/applications/${consentId}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(revokeMissing.status).toBe(404)
  })
})
