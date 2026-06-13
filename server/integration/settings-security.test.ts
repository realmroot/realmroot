import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createUser, type Harness, signIn, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

describe('public configz over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('builds the public contract from settings, branding, and enabled connectors (real SQL)', async () => {
    const response = await harness.request('/api/configz')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      signIn: { passwordEnabled: boolean }
      branding: unknown
      accountCenter: unknown
    }
    expect(body.signIn.passwordEnabled).toBe(true)
    expect(body.branding).toBeTruthy()
    expect(body.accountCenter).toBeTruthy()
  })
})

describe('management settings over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('rejects anonymous reads with 401', async () => {
    expect((await harness.request('/api/management/sign-in-settings')).status).toBe(401)
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
    expect(
      (await harness.request('/api/management/branding-settings', { headers: { cookie: memberCookie } })).status,
    ).toBe(403)
  })

  it('reads and writes sign-in, branding, and account-center settings through real SQL [spec: management-api/management-restish-settings-update]', async () => {
    const cookie = await signInAdmin(harness)

    const signInRead = await harness.request('/api/management/sign-in-settings', { headers: { cookie } })
    expect(signInRead.status).toBe(200)
    const signInWrite = await harness.request('/api/management/sign-in-settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ builtInProviders: { email: { enabled: true } } }),
    })
    expect(signInWrite.status, await signInWrite.clone().text()).toBe(200)

    const brandingRead = await harness.request('/api/management/branding-settings', { headers: { cookie } })
    expect(brandingRead.status).toBe(200)
    const brandingWrite = await harness.request('/api/management/branding-settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ branding: { primaryColor: '#1144ff' } }),
    })
    expect(brandingWrite.status, await brandingWrite.clone().text()).toBe(200)

    const accountCenterRead = await harness.request('/api/management/account-center-settings', { headers: { cookie } })
    expect(accountCenterRead.status).toBe(200)
    const accountCenterWrite = await harness.request('/api/management/account-center-settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ accountCenter: { profileEditingEnabled: false } }),
    })
    expect(accountCenterWrite.status, await accountCenterWrite.clone().text()).toBe(200)

    // The public contract reflects the persisted branding change (getBranding real SQL).
    const configz = await harness.request('/api/configz')
    expect(((await configz.json()) as { branding: { primaryColor: string | null } }).branding.primaryColor).toBe(
      '#1144ff',
    )
  })

  it('rejects an invalid branding payload with 400', async () => {
    const cookie = await signInAdmin(harness)
    const response = await harness.request('/api/management/branding-settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ branding: { primaryColor: 'not-a-hex-color' } }),
    })
    expect(response.status).toBe(400)
  })

  it('exposes the readiness summary built from real SQL', async () => {
    const cookie = await signInAdmin(harness)
    const response = await harness.request('/api/management/readiness', { headers: { cookie } })
    expect(response.status).toBe(200)
  })
})

describe('security policy and per-user security over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('rejects anonymous policy reads with 401', async () => {
    expect((await harness.request('/api/management/security/policy')).status).toBe(401)
  })

  it('reads and updates the security policy through real SQL', async () => {
    const cookie = await signInAdmin(harness)

    const read = await harness.request('/api/management/security/policy', { headers: { cookie } })
    expect(read.status).toBe(200)
    expect(((await read.json()) as { policy: { mfa: { mode: string } } }).policy.mfa.mode).toBeTruthy()

    const updated = await harness.request('/api/management/security/policy', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ policy: { mfa: { mode: 'required' } } }),
    })
    expect(updated.status, await updated.clone().text()).toBe(200)
    expect(((await updated.json()) as { policy: { mfa: { mode: string } } }).policy.mfa.mode).toBe('required')
  })

  it('rejects an invalid policy payload with 400', async () => {
    const cookie = await signInAdmin(harness)
    const response = await harness.request('/api/management/security/policy', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ policy: { mfa: { mode: 'not-a-mode' } } }),
    })
    expect(response.status).toBe(400)
  })

  it('reads a user security state, passkeys, and sessions through real SQL', async () => {
    const cookie = await signInAdmin(harness)
    const userId = await createUser(harness, cookie, {
      email: 'secured@example.com',
      username: 'secured',
      displayName: 'Secured',
      password: 'secured-password-2026',
    })

    const state = await harness.request(`/api/management/security/users/${userId}`, { headers: { cookie } })
    expect(state.status).toBe(200)
    expect(((await state.json()) as { security: { passkeys: { count: number } } }).security.passkeys.count).toBe(0)

    const passkeys = await harness.request(`/api/management/security/users/${userId}/passkeys`, { headers: { cookie } })
    expect(passkeys.status).toBe(200)
    expect(((await passkeys.json()) as { passkeys: unknown[] }).passkeys).toEqual([])

    const sessions = await harness.request(`/api/management/security/users/${userId}/sessions`, { headers: { cookie } })
    expect(sessions.status).toBe(200)
  })
})

describe('account security self-service over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('reads the account security state and passkeys through real SQL', async () => {
    const adminCookie = await signInAdmin(harness)
    await createUser(harness, adminCookie, {
      email: 'self-sec@example.com',
      username: 'selfsec',
      displayName: 'Self Sec',
      password: 'self-sec-password-2026',
    })
    const cookie = await signIn(harness, 'self-sec@example.com', 'self-sec-password-2026')

    const security = await harness.request('/api/account/security', { headers: { cookie } })
    expect(security.status).toBe(200)

    const passkeys = await harness.request('/api/account/security/passkeys', { headers: { cookie } })
    expect(passkeys.status).toBe(200)

    const sessions = await harness.request('/api/account/security/sessions', { headers: { cookie } })
    expect(sessions.status).toBe(200)
    expect(((await sessions.json()) as { sessions: unknown[] }).sessions.length).toBeGreaterThanOrEqual(1)
  })
})
