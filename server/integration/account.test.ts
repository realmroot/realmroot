import { applyD1Migrations, env, reset } from 'cloudflare:test'
import {
  agentAccessRequest,
  agentIdentity,
  agentIdentityBinding,
  apiResource,
  account as authAccount,
  identityProviderConnector,
  invitation,
  oauthRefreshToken,
  providerConnection,
  providerResourceAuthorization,
  resourceConnectionIntent,
  resourceScopeEntitlement,
  session,
  teamMember,
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
  platformOrganizationId,
  realmrootResourceServerId,
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

  it('clears session context and revokes private refresh tokens when Better Auth removes a member [spec: hosted-auth/application-visibility-admission]', async () => {
    const { adminCookie, cookie: ownerCookie, userId: ownerUserId } = await signedInUser(harness)
    const removedUserId = await createUser(harness, adminCookie, {
      email: 'removed-member@example.com',
      username: 'removed-member',
      displayName: 'Removed Member',
      password: 'removed-member-password-2026',
    })
    let removedCookie = await signIn(harness, 'removed-member@example.com', 'removed-member-password-2026')
    const now = Date.now()
    await env.DB.prepare(
      'INSERT INTO organization (id, slug, name, disabled, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
    )
      .bind('org-member-removal', 'member-removal', 'Member removal', now, now)
      .run()
    await env.DB.prepare(
      'INSERT INTO member (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)',
    )
      .bind(
        'member-removal-owner',
        'org-member-removal',
        ownerUserId,
        'owner',
        now,
        now,
        'member-removal-target',
        'org-member-removal',
        removedUserId,
        'member',
        now,
        now,
      )
      .run()
    const setActive = await harness.request('/api/auth/organization/set-active', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: removedCookie, origin: baseURL },
      body: JSON.stringify({ organizationId: 'org-member-removal' }),
    })
    expect(setActive.status, await setActive.clone().text()).toBe(200)
    removedCookie = mergeResponseCookies(removedCookie, setActive)

    const createApplication = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        name: 'Member Removal App',
        clientType: 'public_spa',
        redirectUris: ['http://localhost/member-removal-callback'],
        ownerOrganizationId: 'org-member-removal',
        visibility: 'private',
      }),
    })
    expect(createApplication.status, await createApplication.clone().text()).toBe(201)
    const application = (await createApplication.json()) as { clientId: string }
    await harness.db.insert(oauthRefreshToken).values({
      id: 'member-removal-refresh',
      token: 'member-removal-refresh-hash',
      clientId: application.clientId,
      userId: removedUserId,
      expiresAt: new Date(now + 60_000),
      scopes: 'openid offline_access',
    })

    const remove = await harness.request('/api/auth/organization/remove-member', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie, origin: baseURL },
      body: JSON.stringify({ organizationId: 'org-member-removal', memberIdOrEmail: 'member-removal-target' }),
    })
    expect(remove.status, await remove.clone().text()).toBe(200)
    await expect(
      harness.db
        .select({ revoked: oauthRefreshToken.revoked })
        .from(oauthRefreshToken)
        .where(eq(oauthRefreshToken.id, 'member-removal-refresh')),
    ).resolves.toEqual([{ revoked: expect.any(Date) }])
    await expect(
      harness.db
        .select({ activeOrganizationId: session.activeOrganizationId })
        .from(session)
        .where(eq(session.userId, removedUserId)),
    ).resolves.toEqual([expect.objectContaining({ activeOrganizationId: null })])
    expect(removedCookie).toContain('better-auth.session_token=')
  })

  it('rejects anonymous profile reads with 401', async () => {
    expect((await harness.request('/api/account/profile')).status).toBe(401)
  })

  it('completes hosted sign-up, sign-in, and account center as one real journey [spec: hosted-auth/normal-signup-signin-account]', async () => {
    harness = await createHarness({ emailDeliveryReady: true })
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

    const unverifiedSignIn = await harness.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'newcomer@example.com', password: 'newcomer-password-2026' }),
    })
    expect(unverifiedSignIn.status).toBe(403)
    await expect(unverifiedSignIn.json()).resolves.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' })

    const verificationMessage = harness.sentEmails.find((message) => message.subject === 'Verify your email address')
    expect(verificationMessage?.text).toBeTruthy()
    const verificationUrl = new URL(verificationMessage?.text?.split('\n').at(-1) ?? '')
    const verify = await harness.request(`${verificationUrl.pathname}${verificationUrl.search}`)
    expect(verify.status).toBe(302)

    const cookie = await signIn(harness, 'newcomer@example.com', 'newcomer-password-2026')

    const profile = await harness.request('/api/account/profile', { headers: { cookie } })
    expect(profile.status).toBe(200)
    expect(((await profile.json()) as { user: { email: string } }).user.email).toBe('newcomer@example.com')
  })

  it('sends verification when delivery becomes ready for an existing account [spec: hosted-auth/email-readiness-verification]', async () => {
    await bootstrapAdmin(harness)
    const signUp = await harness.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseURL },
      body: JSON.stringify({
        email: 'existing@example.com',
        name: 'Existing User',
        username: 'existinguser',
        password: 'existing-password-2026',
      }),
    })
    expect(signUp.status, await signUp.clone().text()).toBe(200)
    expect(harness.sentEmails).toHaveLength(0)

    harness = await createHarness({ emailDeliveryReady: true })
    const blockedSignIn = await harness.request('/api/auth/sign-in/username', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'existinguser', password: 'existing-password-2026' }),
    })
    expect(blockedSignIn.status).toBe(403)
    await expect(blockedSignIn.json()).resolves.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' })

    const verificationMessage = harness.sentEmails.find((message) => message.subject === 'Verify your email address')
    expect(verificationMessage?.text).toBeTruthy()
    const verificationUrl = new URL(verificationMessage?.text?.split('\n').at(-1) ?? '')
    const verify = await harness.request(`${verificationUrl.pathname}${verificationUrl.search}`)
    expect(verify.status).toBe(302)

    await expect(signIn(harness, 'existing@example.com', 'existing-password-2026')).resolves.toContain(
      'better-auth.session_token=',
    )
  })

  it('completes self-service password recovery with a code-only email', async () => {
    const adminCookie = await signInAdmin(harness)
    await createUser(harness, adminCookie, {
      email: 'otp-recovery@example.com',
      username: 'otprecovery',
      displayName: 'OTP Recovery',
      password: 'old-password-2026',
    })

    const requested = await harness.request('/api/auth/email-otp/request-password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'otp-recovery@example.com' }),
    })
    expect(requested.status, await requested.clone().text()).toBe(200)

    const message = harness.sentEmails.find((email) => email.subject === 'Your Realmroot code')
    expect(message?.text).not.toMatch(/https?:\/\//)
    const otp = message?.text?.match(/\b\d{6}\b/)?.[0]
    expect(otp).toBeTruthy()

    const completed = await harness.request('/api/auth/email-otp/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'otp-recovery@example.com', otp, password: 'new-password-2026' }),
    })
    expect(completed.status, await completed.clone().text()).toBe(200)
    await expect(signIn(harness, 'otp-recovery@example.com', 'new-password-2026')).resolves.toContain(
      'better-auth.session_token=',
    )
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
      username: 'expired-request-agent.00000000000000000000000000000005',
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
      resourceId: realmrootResourceServerId,
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
    await expect(response.json()).resolves.toMatchObject({ items: [], pagination: { totalItems: 0 } })
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

    const initialTeams = await harness.request(
      `/api/auth/organization/list-teams?organizationId=${encodeURIComponent(organizationId)}`,
      { headers },
    )
    expect(initialTeams.status, await initialTeams.clone().text()).toBe(200)
    await expect(initialTeams.json()).resolves.toEqual([])
    const invalidTeam = await harness.request('/api/auth/organization/create-team', {
      method: 'POST',
      headers,
      body: JSON.stringify({ organizationId, name: 'Platform Admins' }),
    })
    expect(invalidTeam.status).toBe(400)
    const createdTeam = await harness.request('/api/auth/organization/create-team', {
      method: 'POST',
      headers,
      body: JSON.stringify({ organizationId, name: 'platform-admins' }),
    })
    expect(createdTeam.status, await createdTeam.clone().text()).toBe(200)
    const teamId = ((await createdTeam.json()) as { id: string }).id
    const secondTeam = await harness.request('/api/auth/organization/create-team', {
      method: 'POST',
      headers,
      body: JSON.stringify({ organizationId, name: 'release-engineers' }),
    })
    expect(secondTeam.status, await secondTeam.clone().text()).toBe(200)
    const secondTeamId = ((await secondTeam.json()) as { id: string }).id
    await expect(harness.db.select().from(teamMember).where(eq(teamMember.teamId, teamId))).resolves.toEqual([])
    const emptyTeamMembers = await harness.request(
      `/api/account/organizations/${organizationId}/teams/${teamId}/members`,
      { headers: { cookie } },
    )
    expect(emptyTeamMembers.status, await emptyTeamMembers.clone().text()).toBe(200)
    await expect(emptyTeamMembers.json()).resolves.toMatchObject({ items: [], pagination: { totalItems: 0 } })
    const invalidRename = await harness.request('/api/auth/organization/update-team', {
      method: 'POST',
      headers,
      body: JSON.stringify({ teamId, data: { name: 'Platform Owners' } }),
    })
    expect(invalidRename.status).toBe(400)
    const duplicateTeam = await harness.request('/api/auth/organization/create-team', {
      method: 'POST',
      headers,
      body: JSON.stringify({ organizationId, name: 'platform-admins' }),
    })
    expect(duplicateTeam.status).toBe(409)

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
        authorizationModel: 'native',
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
      username: 'household-assistant.00000000000000000000000000000006',
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
      body: JSON.stringify({
        organizationId,
        email: 'developer@example.com',
        role: 'developer',
        teamId: [teamId, secondTeamId],
      }),
    })
    expect(invited.status, await invited.clone().text()).toBe(200)
    const invitationId = ((await invited.json()) as { id: string }).id
    await expect(
      harness.db.select({ teamId: invitation.teamId }).from(invitation).where(eq(invitation.id, invitationId)),
    ).resolves.toEqual([{ teamId: `${teamId},${secondTeamId}` }])

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
      items: expect.arrayContaining([expect.objectContaining({ key: 'owner', predefined: true })]),
    })
    await harness.db.insert(resourceScopeEntitlement).values([
      {
        id: 'ent_household_revoked',
        resourceServerId: resourceId,
        agentIdentityId: 'household-agent',
        authorizationDetails: [],
        authorizationContextHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
        scope: 'household:write',
        mode: 'persistent',
        grantedByUserId: userId,
        endedAt: now,
        endReason: 'revoked',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'ent_household_expired',
        resourceServerId: resourceId,
        agentIdentityId: 'household-agent',
        authorizationDetails: [],
        authorizationContextHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
        scope: 'household:admin',
        mode: 'until',
        grantedByUserId: userId,
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        createdAt: now,
        updatedAt: now,
      },
    ])
    const agentPermissions = await harness.request('/api/agents/household-agent/permissions', {
      headers: { cookie },
    })
    expect(agentPermissions.status, await agentPermissions.clone().text()).toBe(200)
    await expect(agentPermissions.json()).resolves.toMatchObject({
      items: [{ id: 'ent_household', agentId: 'household-agent', scope: 'household:read' }],
      pagination: { totalItems: 1 },
    })
    const authorizedResourceServers = await harness.request('/api/agents/household-agent/authorized-resource-servers', {
      headers: { cookie },
    })
    await expect(authorizedResourceServers.json()).resolves.toMatchObject({
      items: [{ id: resourceId, name: 'Test Resource API', identifier: 'household-api', permissionCount: 1 }],
      pagination: { totalItems: 1 },
    })
    const inactiveAgentPermissions = await harness.request('/api/agents/household-agent/permissions?status=inactive', {
      headers: { cookie },
    })
    await expect(inactiveAgentPermissions.json()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'ent_household_revoked', status: 'ended', endReason: 'revoked' }),
        expect.objectContaining({ id: 'ent_household_expired', status: 'ended', endReason: 'expired' }),
      ]),
      pagination: { totalItems: 2 },
    })
    const explicitlyActiveAgentPermissions = await harness.request(
      '/api/agents/household-agent/permissions?status=active',
      { headers: { cookie } },
    )
    await expect(explicitlyActiveAgentPermissions.json()).resolves.toMatchObject({
      items: [{ id: 'ent_household' }],
      pagination: { totalItems: 1 },
    })
    expect((await harness.request('/api/agents/missing-agent/permissions', { headers: { cookie } })).status).toBe(404)
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
    expect(((await sessions.json()) as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1)

    const linked = await harness.request('/api/account/linked-accounts', { headers: { cookie } })
    expect(linked.status).toBe(200)
    expect(((await linked.json()) as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1)

    const apps = await harness.request('/api/account/application-authorizations', { headers: { cookie } })
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
      authenticationEnabled: false,
      resourceAuthorizationEnabled: true,
      resourceClientId: 'realmroot-client',
      resourceClientSecret: 'realmroot-secret',
      resourceIssuer: 'https://adapter.example.com/oauth/provider',
      resourceAuthorizationEndpoint: 'https://adapter.example.com/oauth/provider/authorize',
      resourceTokenEndpoint: 'https://adapter.example.com/oauth/provider/token',
      resourceUserInfoEndpoint: 'https://adapter.example.com/oauth/provider/userinfo',
      resourceJwksEndpoint: 'https://adapter.example.com/oauth/provider/jwks',
      resourceRevocationEndpoint: 'https://adapter.example.com/oauth/provider/revoke',
      resourceRegistrationMode: 'manual',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(apiResource).values({
      id: 'resource-provider',
      identifier: 'provider-api',
      name: 'Provider API',
      resourceUrl: 'https://adapter.example.com/provider',
      authorizationModel: 'external',
      connectorId: 'connector-provider',
      authorizationDetails: [],
      enabled: true,
      ownerOrganizationId: platformOrganizationId,
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
    expect(new URL(body.authorizationUrl).searchParams.get('client_id')).toBe('realmroot-client')
    const [persisted] = await harness.db
      .select()
      .from(resourceConnectionIntent)
      .where(eq(resourceConnectionIntent.id, body.id))
    expect(persisted).toMatchObject({
      resourceId: 'resource-provider',
      ownerUserId: userId,
      status: 'pending',
    })
  })

  it('[spec: account-center/provider-connection-sign-in-linking] attaches matching sign-in without replacing Provider authority', async () => {
    const { userId } = await signedInUser(harness)
    const now = new Date()
    await harness.db.insert(identityProviderConnector).values({
      id: 'connector-link-provider',
      slug: 'link-provider',
      providerType: 'social',
      providerId: 'link-provider',
      displayName: 'Link Provider',
      enabled: true,
      authenticationEnabled: true,
      resourceAuthorizationEnabled: true,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(apiResource).values({
      id: 'resource-link-provider',
      identifier: 'link-provider-api',
      name: 'Link Provider API',
      resourceUrl: 'https://adapter.example.com/link-provider',
      authorizationModel: 'external',
      connectorId: 'connector-link-provider',
      ownerOrganizationId: platformOrganizationId,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(providerConnection).values({
      id: 'connection-link-provider',
      connectorId: 'connector-link-provider',
      ownerUserId: userId,
      externalSubject: 'provider-subject',
      displayName: 'Provider Subject',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(providerResourceAuthorization).values({
      id: 'authorization-link-provider',
      providerConnectionId: 'connection-link-provider',
      resourceId: 'resource-link-provider',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })

    await harness.db.insert(authAccount).values({
      id: 'account-link-provider',
      accountId: 'provider-subject',
      providerId: 'link-provider',
      userId,
      createdAt: now,
      updatedAt: now,
    })

    expect(
      await harness.db
        .select()
        .from(providerConnection)
        .where(eq(providerConnection.connectorId, 'connector-link-provider')),
    ).toMatchObject([
      {
        id: 'connection-link-provider',
        authenticationAccountId: 'account-link-provider',
        externalSubject: 'provider-subject',
        displayName: 'Provider Subject',
      },
    ])
    expect(
      await harness.db
        .select()
        .from(providerResourceAuthorization)
        .where(eq(providerResourceAuthorization.id, 'authorization-link-provider')),
    ).toMatchObject([{ providerConnectionId: 'connection-link-provider', status: 'active' }])

    await expect(
      harness.db.insert(authAccount).values({
        id: 'account-link-provider-mismatch',
        accountId: 'different-provider-subject',
        providerId: 'link-provider',
        userId,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow()
    expect(
      await harness.db
        .select({ id: authAccount.id })
        .from(authAccount)
        .where(eq(authAccount.id, 'account-link-provider-mismatch')),
    ).toEqual([])
    expect(
      await harness.db
        .select()
        .from(providerConnection)
        .where(eq(providerConnection.connectorId, 'connector-link-provider')),
    ).toMatchObject([
      {
        id: 'connection-link-provider',
        authenticationAccountId: 'account-link-provider',
        externalSubject: 'provider-subject',
      },
    ])
    expect(
      await harness.db
        .select()
        .from(providerResourceAuthorization)
        .where(eq(providerResourceAuthorization.id, 'authorization-link-provider')),
    ).toMatchObject([{ providerConnectionId: 'connection-link-provider', status: 'active' }])
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
