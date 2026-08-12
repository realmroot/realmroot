import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createUser, type Harness, platformOrganizationId, signIn, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

/** Smallest byte string that sniffs as a PNG (8-byte signature + padding). */
function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00])
}

function pngForm(purpose?: string): FormData {
  const form = new FormData()
  form.set('file', new File([pngBytes() as BlobPart], 'logo.png', { type: 'image/png' }))
  if (purpose) form.set('purpose', purpose)
  return form
}

async function uploadManagedAsset(harness: Harness, cookie: string, purpose: string) {
  const response = await harness.request('/api/assets', {
    method: 'POST',
    headers: { cookie, origin: 'http://localhost' },
    body: pngForm(purpose),
  })
  expect(response.status, await response.clone().text()).toBe(201)
  const { asset } = (await response.json()) as { asset: { id: string } }
  return `/api/assets/${asset.id}`
}

describe('asset upload + read over real D1 and an in-memory bucket', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('rejects an anonymous avatar upload with 401', async () => {
    const response = await harness.request('/api/account/avatar', { method: 'POST', body: pngForm() })
    expect(response.status).toBe(401)
  })

  it('uploads a user avatar, then serves it back (createAsset + findAsset, real SQL)', async () => {
    const adminCookie = await signInAdmin(harness)
    await createUser(harness, adminCookie, {
      email: 'avatar@example.com',
      username: 'avataruser',
      displayName: 'Avatar User',
      password: 'avatar-password-2026',
    })
    const cookie = await signIn(harness, 'avatar@example.com', 'avatar-password-2026')

    const upload = await harness.request('/api/account/avatar', {
      method: 'POST',
      headers: { cookie, origin: 'http://localhost' },
      body: pngForm(),
    })
    expect(upload.status, await upload.clone().text()).toBe(201)
    const asset = ((await upload.json()) as { asset: { id: string } }).asset

    const fetched = await harness.request(`/api/assets/${asset.id}`, { headers: { cookie } })
    expect(fetched.status).toBe(200)
    expect(fetched.headers.get('content-type')).toBe('image/png')
  })

  it('rejects a non-image avatar upload with 400', async () => {
    const adminCookie = await signInAdmin(harness)
    await createUser(harness, adminCookie, {
      email: 'badimg@example.com',
      username: 'badimg',
      displayName: 'Bad Image',
      password: 'badimg-password-2026',
    })
    const cookie = await signIn(harness, 'badimg@example.com', 'badimg-password-2026')

    const form = new FormData()
    form.set('file', new File(['not an image'], 'note.png', { type: 'image/png' }))
    const response = await harness.request('/api/account/avatar', {
      method: 'POST',
      headers: { cookie, origin: 'http://localhost' },
      body: form,
    })
    expect(response.status).toBe(400)
  })

  it('uploads application logo, organization logo, and branding assets (real SQL)', async () => {
    const cookie = await signInAdmin(harness)

    const application = (await (
      await harness.request('/api/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          name: 'Logo App',
          slug: 'logo-app',
          clientType: 'confidential_web',
          redirectUris: ['http://localhost/callback'],
          ownerOrganizationId: platformOrganizationId,
        }),
      })
    ).json()) as { id: string }
    const organization = (await (
      await harness.request('/api/organizations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ slug: 'logo-org', name: 'Logo Org' }),
      })
    ).json()) as { id: string }

    const applicationLogoUrl = await uploadManagedAsset(harness, cookie, 'application_logo')
    const appLogo = await harness.request(`/api/applications/${application.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ iconUrl: applicationLogoUrl }),
    })
    expect(appLogo.status, await appLogo.clone().text()).toBe(200)

    const organizationLogoUrl = await uploadManagedAsset(harness, cookie, 'organization_logo')
    const orgLogo = await harness.request(`/api/organizations/${organization.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ logo: organizationLogoUrl }),
    })
    expect(orgLogo.status, await orgLogo.clone().text()).toBe(200)

    const logoUrl = await uploadManagedAsset(harness, cookie, 'branding_logo')
    const faviconUrl = await uploadManagedAsset(harness, cookie, 'favicon')
    const branding = await harness.request('/api/realm/branding', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ branding: { logoUrl, faviconUrl } }),
    })
    expect(branding.status, await branding.clone().text()).toBe(200)
  })

  it('detaches managed brand assets when Console clears them [spec: admin-console/admin-branding-settings]', async () => {
    const cookie = await signInAdmin(harness)
    const logoUrl = await uploadManagedAsset(harness, cookie, 'branding_logo')
    const faviconUrl = await uploadManagedAsset(harness, cookie, 'favicon')
    const attach = await harness.request('/api/realm/branding', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ branding: { logoUrl, faviconUrl } }),
    })
    expect(attach.status, await attach.clone().text()).toBe(200)

    const before = await harness.request('/api/realm/branding', { headers: { cookie } })
    expect(before.status).toBe(200)
    await expect(before.json()).resolves.toMatchObject({
      branding: {
        logoUrl: expect.stringMatching(/^\/api\/assets\//),
        faviconUrl: expect.stringMatching(/^\/api\/assets\//),
      },
    })

    const cleared = await harness.request('/api/realm/branding', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ branding: { logoUrl: null, faviconUrl: null } }),
    })
    expect(cleared.status, await cleared.clone().text()).toBe(200)
    await expect(cleared.json()).resolves.toMatchObject({
      branding: { logoUrl: null, faviconUrl: null },
    })
  })
})
