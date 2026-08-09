import { applyD1Migrations, env, reset } from 'cloudflare:test'
import {
  agentAccessRequest,
  agentIdentity,
  agentIdentityBinding,
  apiResource,
  identityProviderConnector,
  resourceConnectionIntent,
  resourceScopeEntitlement,
  verification,
} from '@server/db/schema'
import { eq } from 'drizzle-orm'
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  baseURL,
  bootstrapAdmin,
  createHarness,
  createUser,
  type Harness,
  resourceOpenApiFetch,
  seedAgent,
  signIn,
  signInAdmin,
} from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

async function signedInUser(harness: Harness): Promise<{ adminCookie: string; cookie: string; userId: string }> {
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
  return { adminCookie, cookie, userId }
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

  it('excludes expired Agent access requests from the controller queue [spec: agent-identity/agent-resource-approval]', async () => {
    const { cookie, userId } = await signedInUser(harness)
    const seededAgent = await seedAgent(harness, userId, 'expired-access-request')
    const now = new Date()
    await harness.db.insert(agentIdentity).values({
      id: 'expired-access-request-identity',
      issuer: 'http://localhost/api/auth',
      subject: 'expired-access-request-subject',
      name: 'Expired request Agent',
      ownerUserId: userId,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentIdentityBinding).values({
      id: 'expired-access-request-binding',
      agentIdentityId: 'expired-access-request-identity',
      protocolAgentId: seededAgent.agentId,
      status: 'active',
      boundAt: now,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentAccessRequest).values({
      id: 'expired-access-request',
      resourceId: 'res_realmroot',
      agentIdentityId: 'expired-access-request-identity',
      bindingId: 'expired-access-request-binding',
      scopes: ['agents:read'],
      authorizationDetails: [],
      status: 'pending',
      approvalTokenHash: 'expired-access-request-token-hash',
      encryptedApprovalToken: 'expired-access-request-token',
      expiresAt: new Date(now.getTime() - 60_000),
      createdAt: new Date(now.getTime() - 120_000),
      updatedAt: now,
    })

    const response = await harness.request('/api/account/access-requests', { headers: { cookie } })

    expect(response.status, await response.clone().text()).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ items: [], pagination: { total: 0 } })
  })

  it('creates and manages a consumer Organization without Console access [spec: account-center/account-organization-management] [spec: account-center/consumer-organization-boundary]', async () => {
    const { adminCookie, cookie: initialCookie, userId } = await signedInUser(harness)
    let cookie = initialCookie
    const currentPolicyResponse = await harness.request('/api/realm/organization-creation-policy', {
      headers: { cookie: adminCookie },
    })
    expect(currentPolicyResponse.status, await currentPolicyResponse.clone().text()).toBe(200)
    const currentPolicy = (await currentPolicyResponse.json()) as Record<string, unknown>
    const policy = await harness.request('/api/realm/organization-creation-policy', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: adminCookie,
        'If-Match': currentPolicyResponse.headers.get('ETag')!,
      },
      body: JSON.stringify({ ...currentPolicy, mode: 'approved_users', approvedUserIds: [userId] }),
    })
    expect(policy.status, await policy.clone().text()).toBe(200)
    let headers = { 'content-type': 'application/json', cookie, origin: baseURL }

    const created = await harness.request('/api/auth/organization/create', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Product Lab', slug: 'product-lab' }),
    })
    expect(created.status, await created.clone().text()).toBe(200)
    const organizationId = ((await created.json()) as { id: string }).id

    const clearActive = await harness.request('/api/auth/organization/set-active', {
      method: 'POST',
      headers,
      body: JSON.stringify({ organizationId: null }),
    })
    expect(clearActive.status, await clearActive.clone().text()).toBe(200)
    cookie = mergeResponseCookies(cookie, clearActive)
    headers = { 'content-type': 'application/json', cookie, origin: baseURL }
    await expect(
      (await harness.request('/api/account/organization-context', { headers: { cookie } })).json(),
    ).resolves.toMatchObject({
      activeOrganizationId: null,
    })
    const switchActive = await harness.request('/api/auth/organization/set-active', {
      method: 'POST',
      headers,
      body: JSON.stringify({ organizationId }),
    })
    expect(switchActive.status, await switchActive.clone().text()).toBe(200)
    cookie = mergeResponseCookies(cookie, switchActive)
    headers = { 'content-type': 'application/json', cookie, origin: baseURL }
    await expect(
      (await harness.request('/api/account/organization-context', { headers: { cookie } })).json(),
    ).resolves.toMatchObject({
      activeOrganizationId: organizationId,
    })
    await expect(
      (await harness.request('/api/account/developer-console-access', { headers: { cookie } })).json(),
    ).resolves.toMatchObject({ platformOperator: false, consoleOrganizations: [] })

    harness.deps.externalHttp.fetch = resourceOpenApiFetch
    const resourceResponse = await harness.request('/api/resource-servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        identifier: 'household-api',
        resourceUrl: 'https://household.example.com/api',
        accessMode: 'realmroot',
        enabled: false,
        ownerOrganizationId: organizationId,
      }),
    })
    expect(resourceResponse.status, await resourceResponse.clone().text()).toBe(201)
    const resourceId = ((await resourceResponse.json()) as { id: string }).id
    const now = new Date()
    await harness.db.insert(agentIdentity).values({
      id: 'household-agent',
      issuer: 'http://localhost/api/auth',
      subject: 'household-agent-subject',
      name: 'Household assistant',
      ownerOrganizationId: organizationId,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(resourceScopeEntitlement).values({
      id: 'ent_household',
      resourceServerId: resourceId,
      agentIdentityId: 'household-agent',
      authorizationDetails: [],
      authorizationContextHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
      scope: 'household:read',
      mode: 'persistent',
      grantedByUserId: userId,
      createdAt: now,
      updatedAt: now,
    })

    const updated = await harness.request('/api/auth/organization/update', {
      method: 'POST',
      headers,
      body: JSON.stringify({ organizationId, data: { name: 'Product Engineering', slug: 'product-engineering' } }),
    })
    expect(updated.status, await updated.clone().text()).toBe(200)

    const invited = await harness.request('/api/auth/organization/invite-member', {
      method: 'POST',
      headers,
      body: JSON.stringify({ organizationId, email: 'developer@example.com', role: 'developer' }),
    })
    expect(invited.status, await invited.clone().text()).toBe(200)

    const detail = await harness.request(
      `/api/auth/organization/get-full-organization?organizationId=${organizationId}`,
      {
        headers: { cookie },
      },
    )
    expect(detail.status, await detail.clone().text()).toBe(200)
    const body = (await detail.json()) as {
      name: string
      members: Array<{ userId: string; role: string }>
      invitations: Array<{ email: string; role: string; status: string }>
    }
    expect(body.name).toBe('Product Engineering')
    expect(body.members).toEqual(expect.arrayContaining([expect.objectContaining({ userId, role: 'owner' })]))
    expect(body.invitations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: 'developer@example.com', role: 'developer', status: 'pending' }),
      ]),
    )

    const agents = await harness.request(`/api/account/organizations/${organizationId}/agents`, {
      headers: { cookie },
    })
    expect(agents.status, await agents.clone().text()).toBe(200)
    await expect(agents.json()).resolves.toMatchObject({ items: [{ id: 'household-agent' }] })
    const roles = await harness.request(`/api/organizations/${organizationId}/roles`, { headers: { cookie } })
    expect(roles.status, await roles.clone().text()).toBe(200)
    await expect(roles.json()).resolves.toMatchObject({
      roles: expect.arrayContaining([expect.objectContaining({ key: 'owner', predefined: true })]),
    })
    const agentScopeEntitlements = await harness.request(
      '/api/agents/household-agent/scope-entitlements?status=active',
      {
        headers: { cookie },
      },
    )
    expect(agentScopeEntitlements.status, await agentScopeEntitlements.clone().text()).toBe(200)
    await expect(agentScopeEntitlements.json()).resolves.toMatchObject({
      items: [{ id: 'ent_household', agentId: 'household-agent', scope: 'household:read' }],
    })
    expect(
      (await harness.request('/api/agents/missing-agent/scope-entitlements', { headers: { cookie } })).status,
    ).toBe(404)
    const profile = await harness.request('/api/account/profile', { headers: { cookie } })
    await expect(profile.json()).resolves.toMatchObject({ user: { id: userId } })
    const developerAccess = await harness.request('/api/account/developer-console-access', {
      headers: { cookie },
    })
    await expect(developerAccess.json()).resolves.toMatchObject({
      platformOperator: false,
      consoleOrganizations: [],
    })
    expect((await harness.request('/api/applications', { headers: { cookie } })).status).toBe(200)
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

  it('[spec: account-center/provider-connections] creates a provider connection intent through real HTTP and D1', async () => {
    const { cookie, userId } = await signedInUser(harness)
    const now = new Date()
    await harness.db.insert(identityProviderConnector).values({
      id: 'connector-provider',
      slug: 'provider',
      providerType: 'social',
      providerId: 'provider',
      displayName: 'Provider',
      enabled: true,
      loginEnabled: false,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(apiResource).values({
      id: 'resource-provider',
      identifier: 'provider-api',
      name: 'Provider API',
      resourceUrl: 'https://adapter.example.com/provider',
      accessMode: 'brokered',
      connectorId: 'connector-provider',
      authorizationDetails: [],
      enabled: true,
      ownerOrganizationId: 'org_platform',
      visibility: 'public',
      availableToAgents: true,
      scopeRegistry: {
        discovery: {
          sourceUrl: 'https://adapter.example.com/.well-known/oauth-protected-resource/provider',
          etag: null,
          documentHash: 'provider-contract',
          syncedAt: now.toISOString(),
          lastError: null,
        },
        scopes: [{ value: 'provider:read', description: null, grantMode: 'assigned' }],
        accountConnection: {
          mode: 'brokered',
          authorizationEndpoint: 'https://adapter.example.com/provider/account-connection-authorizations',
          tokenEndpoint: 'https://adapter.example.com/provider/account-connection-credentials',
        },
      },
      createdAt: now,
      updatedAt: now,
    })

    const response = await harness.request('/api/account/provider-connection-intents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ connectorId: 'connector-provider' }),
    })

    expect(response.status, await response.clone().text()).toBe(201)
    expect(response.headers.get('location')).toBeNull()
    const body = (await response.json()) as { id: string; connectorId: string; authorizationUrl: string }
    expect(body.connectorId).toBe('connector-provider')
    expect(new URL(body.authorizationUrl).searchParams.get('request')).toBeTruthy()
    const [persisted] = await harness.db
      .select()
      .from(resourceConnectionIntent)
      .where(eq(resourceConnectionIntent.id, body.id))
    expect(persisted).toMatchObject({
      resourceId: 'resource-provider',
      ownerUserId: userId,
      authorizationMode: 'brokered',
      status: 'pending',
    })

    await expect(
      harness.db.insert(apiResource).values({
        id: 'resource-provider-duplicate',
        identifier: 'provider-api-duplicate',
        name: 'Duplicate Provider API',
        resourceUrl: 'https://adapter.example.com/provider-duplicate',
        accessMode: 'brokered',
        connectorId: 'connector-provider',
        authorizationDetails: [],
        enabled: true,
        ownerOrganizationId: 'org_platform',
        visibility: 'public',
        availableToAgents: true,
        scopeRegistry: {
          discovery: {
            sourceUrl: 'https://adapter.example.com/.well-known/oauth-protected-resource/provider-duplicate',
            etag: null,
            documentHash: 'duplicate-contract',
            syncedAt: now.toISOString(),
            lastError: null,
          },
          scopes: [{ value: 'provider:read', description: null, grantMode: 'assigned' }],
          accountConnection: {
            mode: 'brokered',
            authorizationEndpoint: 'https://adapter.example.com/provider-duplicate/authorizations',
            tokenEndpoint: 'https://adapter.example.com/provider-duplicate/credentials',
          },
        },
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow()
  })

  it('links and unlinks a SIWE wallet address through real SQL', async () => {
    const adminCookie = await signInAdmin(harness)
    // Enable the web3 wallet provider so the account-center linking path is allowed.
    const chainId = 1
    const enable = await harness.request('/api/realm/sign-in-policy', {
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
