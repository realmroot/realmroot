import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { verification } from '@server/db/schema'
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { baseURL, bootstrapAdmin, createHarness, createUser, type Harness, signIn, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

async function signedInUser(harness: Harness): Promise<{ cookie: string; userId: string }> {
  const adminCookie = await signInAdmin(harness)
  await createUser(harness, adminCookie, {
    email: 'account@example.com',
    username: 'accountuser',
    displayName: 'Account User',
    password: 'account-password-2026',
  })
  const cookie = await signIn(harness, 'account@example.com', 'account-password-2026')
  const me = await harness.request('/api/account/profile', { headers: { cookie } })
  const userId = ((await me.json()) as { user: { id: string } }).user.id
  return { cookie, userId }
}

describe('account self-service over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('rejects anonymous profile reads with 401', async () => {
    expect((await harness.request('/api/account/profile')).status).toBe(401)
  })

  it('completes hosted sign-up, sign-in, and account center as one real journey [spec: hosted-auth/normal-signup-signin-account]', async () => {
    // Bootstrap the first admin so the deployment is past first-run onboarding,
    // then run public hosted sign-up -> sign-in -> account center over real D1.
    await bootstrapAdmin(harness)

    const signUp = await harness.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseURL },
      body: JSON.stringify({
        email: 'newcomer@example.com',
        name: 'New Comer',
        username: 'newcomer',
        password: 'newcomer-password-2026',
      }),
    })
    expect(signUp.status, await signUp.clone().text()).toBe(200)

    const cookie = await signIn(harness, 'newcomer@example.com', 'newcomer-password-2026')

    const profile = await harness.request('/api/account/profile', { headers: { cookie } })
    expect(profile.status).toBe(200)
    expect(((await profile.json()) as { user: { email: string } }).user.email).toBe('newcomer@example.com')
  })

  it('reads and updates the profile through real SQL [spec: account-center/profile-update]', async () => {
    const { cookie } = await signedInUser(harness)

    const profile = await harness.request('/api/account/profile', { headers: { cookie } })
    expect(profile.status).toBe(200)
    expect(((await profile.json()) as { user: { email: string } }).user.email).toBe('account@example.com')

    const updated = await harness.request('/api/account/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ displayName: 'Renamed Account' }),
    })
    expect(updated.status, await updated.clone().text()).toBe(200)
    expect(((await updated.json()) as { user: { displayName: string } }).user.displayName).toBe('Renamed Account')
  })

  it('rejects an invalid profile update with 400', async () => {
    const { cookie } = await signedInUser(harness)
    const response = await harness.request('/api/account/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ displayName: '' }),
    })
    expect(response.status).toBe(400)
  })

  it('lists sessions and linked accounts through real SQL', async () => {
    const { cookie } = await signedInUser(harness)

    const sessions = await harness.request('/api/account/sessions', { headers: { cookie } })
    expect(sessions.status).toBe(200)
    expect(((await sessions.json()) as { sessions: unknown[] }).sessions.length).toBeGreaterThanOrEqual(1)

    const linked = await harness.request('/api/account/linked-accounts', { headers: { cookie } })
    expect(linked.status).toBe(200)
    expect(((await linked.json()) as { accounts: unknown[] }).accounts.length).toBeGreaterThanOrEqual(1)

    const apps = await harness.request('/api/account/applications', { headers: { cookie } })
    expect(apps.status).toBe(200)
  })

  it('links and unlinks a SIWE wallet address through real SQL', async () => {
    const adminCookie = await signInAdmin(harness)
    // Enable the web3 wallet provider so the account-center linking path is allowed.
    const chainId = 1
    const enable = await harness.request('/api/management/sign-in-settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ builtInProviders: { web3Wallet: { enabled: true, chains: [chainId] } } }),
    })
    expect(enable.status, await enable.clone().text()).toBe(200)

    await createUser(harness, adminCookie, {
      email: 'account@example.com',
      username: 'accountuser',
      displayName: 'Account User',
      password: 'account-password-2026',
    })
    const cookie = await signIn(harness, 'account@example.com', 'account-password-2026')

    const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
    const address = account.address
    const nonce = 'crownsiwenonce0123456789'

    // The SIWE plugin would normally mint this; seed it so getSiweNonce/deleteSiweNonce
    // run over real SQL without standing up the optional SIWE auth plugin.
    const now = new Date()
    await harness.db.insert(verification).values({
      id: 'siwe-nonce-1',
      identifier: `siwe:${address}:${chainId}`,
      value: nonce,
      expiresAt: new Date(now.getTime() + 10 * 60_000),
      createdAt: now,
      updatedAt: now,
    })

    const message = createSiweMessage({
      address,
      chainId,
      domain: 'localhost',
      nonce,
      uri: 'http://localhost',
      version: '1',
    })
    const signature = await account.signMessage({ message })

    const linked = await harness.request('/api/account/wallet-addresses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost' },
      body: JSON.stringify({ message, signature, walletAddress: address, chainId }),
    })
    expect(linked.status, await linked.clone().text()).toBe(201)

    const accountId = `${address}:${chainId}`
    const unlinked = await harness.request(`/api/account/wallet-addresses/${encodeURIComponent(accountId)}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(unlinked.status).toBe(204)
  })
})
