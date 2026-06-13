import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createUser, type Harness, signIn, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

/** Smallest byte string that sniffs as a PNG (8-byte signature + padding). */
function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00])
}

function pngForm(): FormData {
  const form = new FormData()
  form.set('file', new File([pngBytes() as BlobPart], 'logo.png', { type: 'image/png' }))
  return form
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
      await harness.request('/api/management/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          name: 'Logo App',
          slug: 'logo-app',
          clientType: 'confidential_web',
          redirectUris: ['http://localhost/callback'],
        }),
      })
    ).json()) as { id: string }
    const organization = (await (
      await harness.request('/api/management/organizations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ slug: 'logo-org', name: 'Logo Org' }),
      })
    ).json()) as { id: string }

    const appLogo = await harness.request(`/api/management/applications/${application.id}/logo`, {
      method: 'POST',
      headers: { cookie, origin: 'http://localhost' },
      body: pngForm(),
    })
    expect(appLogo.status, await appLogo.clone().text()).toBe(201)

    const orgLogo = await harness.request(`/api/management/organizations/${organization.id}/logo`, {
      method: 'POST',
      headers: { cookie, origin: 'http://localhost' },
      body: pngForm(),
    })
    expect(orgLogo.status, await orgLogo.clone().text()).toBe(201)

    const brandingLogo = await harness.request('/api/management/branding/logo', {
      method: 'POST',
      headers: { cookie, origin: 'http://localhost' },
      body: pngForm(),
    })
    expect(brandingLogo.status, await brandingLogo.clone().text()).toBe(201)

    const favicon = await harness.request('/api/management/branding/favicon', {
      method: 'POST',
      headers: { cookie, origin: 'http://localhost' },
      body: pngForm(),
    })
    expect(favicon.status, await favicon.clone().text()).toBe(201)
  })
})
