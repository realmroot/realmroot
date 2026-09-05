import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { readSiteSettings, writeSiteSettings } from '@server/adapters/repos/site-settings'
import { metadataSchema } from '@server/adapters/repos/site-settings-schemas'
import { createDb } from '@server/db/client'
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, createUser, signIn, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

describe('unified site settings', () => {
  it('[spec: admin-console/site-settings-concurrency] preserves independent groups and rejects stale database writes', async () => {
    const db = createDb(env.DB)
    await Promise.all([
      writeSiteSettings(db, 'general', { supportEmail: 'support@example.com' }, null),
      writeSiteSettings(db, 'security', { mfa: { mode: 'required' } }, null),
    ])
    const before = await readSiteSettings(db, 'general', metadataSchema)
    expect(before?.value).toEqual({ supportEmail: 'support@example.com' })
    expect((await readSiteSettings(db, 'security', metadataSchema))?.value).toEqual({ mfa: { mode: 'required' } })
    await writeSiteSettings(db, 'general', { supportEmail: 'new@example.com' }, 1)
    await expect(writeSiteSettings(db, 'general', { supportEmail: 'stale@example.com' }, 1)).rejects.toMatchObject({
      status: 409,
    })
    await expect(writeSiteSettings(db, 'general', {}, null)).rejects.toMatchObject({ status: 409 })
    expect((await readSiteSettings(db, 'general', metadataSchema))?.value).toEqual({ supportEmail: 'new@example.com' })
  })
  it('[spec: admin-console/site-navigation-settings] persists ordered links, publishes them, rejects stale, invalid and unauthorized writes', async () => {
    const harness = await createHarness()
    expect((await harness.request('/api/realm/navigation')).status).toBe(401)
    const cookie = await signInAdmin(harness)
    const initial = await harness.request('/api/realm/navigation', { headers: { cookie } })
    expect(initial.status).toBe(200)
    const etag = initial.headers.get('etag')!
    const input = {
      externalLinks: [{ id: 'wallet', label: 'Wallet', url: 'https://wallet.example.com', icon: 'wallet' }],
    }
    const put = (body: unknown, version: string | null = etag, session = cookie) =>
      harness.request('/api/realm/navigation', {
        method: 'PUT',
        headers: { cookie: session, 'content-type': 'application/json', ...(version ? { 'If-Match': version } : {}) },
        body: JSON.stringify(body),
      })
    expect((await put(input, null)).status).toBe(428)
    const saved = await put(input)
    expect(saved.status, await saved.clone().text()).toBe(200)
    expect((await put(input)).status).toBe(412)
    const config = (await (await harness.request('/api/configz')).json()) as { navigation: typeof input }
    expect(config.navigation).toEqual(input)
    const current = saved.headers.get('etag')!
    for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:secret@example.com']) {
      expect((await put({ externalLinks: [{ ...input.externalLinks[0], url }] }, current)).status).toBe(400)
    }
    await createUser(harness, cookie, {
      email: 'nav-member@example.com',
      username: 'nav-member',
      displayName: 'Member',
      password: 'member-password-2026',
    })
    const member = await signIn(harness, 'nav-member@example.com', 'member-password-2026')
    expect((await put(input, current, member)).status).toBe(403)
    expect((await put({ externalLinks: [] }, current)).status).toBe(200)
    expect(
      ((await (await harness.request('/api/configz')).json()) as { navigation: typeof input }).navigation.externalLinks,
    ).toEqual([])
  })
})
