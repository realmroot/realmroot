import { applyD1Migrations, env, reset } from 'cloudflare:test'
import {
  agent,
  agentAuditEvent,
  agentCapabilityGrant,
  agentHost,
  agentIdentity,
  agentIdentityBinding,
  approvalRequest,
} from '@server/db/schema'
import { agentGovernanceAuditRecord } from '@server/usecases/agent-audit'
import { createAdditionalAgentEnrollmentIntent, createAgentEnrollmentIntent } from '@server/usecases/agent-identities'
import { createResource } from '@server/usecases/authorization'
import {
  createAccessRequest,
  createAccessRequestCredential,
  listAgentResourceServers,
} from '@server/usecases/external-resources'
import { eq } from 'drizzle-orm'
import { decodeProtectedHeader, exportJWK, generateKeyPair, importJWK, type JWK, jwtVerify, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createHarness,
  createUser,
  type Harness,
  platformOrganizationId,
  realmrootResourceServerId,
  seedAgent,
  signIn,
  signInAdmin,
} from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

describe('Agent identity enrollment over real D1', () => {
  let harness: Harness
  let adminCookie: string
  let ownerCookie: string
  let userId: string

  beforeEach(async () => {
    harness = await createHarness()
    adminCookie = await signInAdmin(harness)
    userId = await createUser(harness, adminCookie, {
      email: 'identity-owner@example.com',
      username: 'identityowner',
      displayName: 'Identity Owner',
      password: 'identity-owner-password-2026',
    })
    const membership = await harness.request(`/api/organizations/${platformOrganizationId}/members`, {
      method: 'POST',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ userId, roles: ['owner'] }),
    })
    expect(membership.status, await membership.clone().text()).toBe(201)
    ownerCookie = await signIn(harness, 'identity-owner@example.com', 'identity-owner-password-2026')
  })

  it('commits controller approval decisions through the Realmroot account boundary [spec: agent-identity/agent-identity-enrollment] [spec: agent-identity/agent-management-authority]', async () => {
    const createdAt = new Date('2026-07-29T00:00:00.000Z')
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
    await harness.db.insert(agentHost).values({
      id: 'approval-host',
      name: 'Approval Host',
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    })
    await harness.db.insert(agent).values({
      id: 'approval-agent',
      name: 'Approval Agent',
      hostId: 'approval-host',
      status: 'pending',
      mode: 'delegated',
      publicKey: '{"kty":"OKP","crv":"Ed25519","x":"approval"}',
      createdAt,
      updatedAt: createdAt,
    })
    await harness.db.insert(approvalRequest).values({
      id: 'approval-login',
      method: 'device_authorization',
      agentId: 'approval-agent',
      hostId: 'approval-host',
      status: 'pending',
      userCodeHash: await hashApprovalCode('ABCD-1234'),
      interval: 5,
      expiresAt,
      createdAt,
      updatedAt: createdAt,
    })

    const loginApproval = await harness.request('/api/account/agent-enrollments/approval-agent/decision', {
      method: 'PUT',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({
        kind: 'protocol',
        userCode: 'ABCD-1234',
        decision: 'approve',
      }),
    })
    expect(loginApproval.status, await loginApproval.clone().text()).toBe(200)
    await expect(loginApproval.json()).resolves.toEqual({ status: 'approved' })

    const [[approvedAgent], [approvedHost], [approvedLogin]] = await Promise.all([
      harness.db.select().from(agent).where(eq(agent.id, 'approval-agent')),
      harness.db.select().from(agentHost).where(eq(agentHost.id, 'approval-host')),
      harness.db.select().from(approvalRequest).where(eq(approvalRequest.id, 'approval-login')),
    ])
    expect(approvedAgent).toMatchObject({ status: 'active', userId })
    expect(approvedHost).toMatchObject({ status: 'active', userId })
    expect(approvedLogin.status).toBe('approved')

    await harness.db.insert(agentCapabilityGrant).values({
      id: 'approval-management-grant',
      agentId: 'approval-agent',
      capability: 'applications:read',
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    })
    await harness.db.insert(approvalRequest).values({
      id: 'approval-management',
      method: 'device_authorization',
      agentId: 'approval-agent',
      hostId: 'approval-host',
      capabilities: 'applications:read',
      status: 'pending',
      userCodeHash: await hashApprovalCode('WXYZ-5678'),
      interval: 5,
      expiresAt,
      createdAt,
      updatedAt: createdAt,
    })

    const capabilityApproval = await harness.request('/api/account/agent-enrollments/approval-agent/decision', {
      method: 'PUT',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({
        kind: 'protocol',
        userCode: 'WXYZ-5678',
        decision: 'approve',
        permissions: ['applications:read'],
      }),
    })
    expect(capabilityApproval.status, await capabilityApproval.clone().text()).toBe(200)

    const [[grant], [capabilityRequest]] = await Promise.all([
      harness.db.select().from(agentCapabilityGrant).where(eq(agentCapabilityGrant.id, 'approval-management-grant')),
      harness.db.select().from(approvalRequest).where(eq(approvalRequest.id, 'approval-management')),
    ])
    expect(grant).toMatchObject({ status: 'active', grantedBy: userId })
    expect(capabilityRequest.status).toBe('approved')

    await harness.db.insert(approvalRequest).values({
      id: 'approval-concurrent',
      method: 'device_authorization',
      agentId: 'approval-agent',
      hostId: 'approval-host',
      status: 'pending',
      userCodeHash: await hashApprovalCode('CONC-1234'),
      interval: 5,
      expiresAt,
      createdAt,
      updatedAt: createdAt,
    })
    const decision = {
      agentId: 'approval-agent',
      userCodeHash: await hashApprovalCode('CONC-1234'),
      userId,
      now: new Date(),
    }
    const audit = (result: 'allowed' | 'denied') =>
      agentGovernanceAuditRecord(harness.deps.ids.generate(), {
        action: 'agent.capability_decided',
        result,
        tenant: { type: 'user', id: userId },
        controllerUserId: userId,
      })
    const [approved, denied] = await Promise.allSettled([
      harness.deps.agents.decideApproval(
        { ...decision, action: 'approve' },
        { ...audit('allowed'), id: 'approval-concurrent-audit-approve' },
      ),
      harness.deps.agents.decideApproval(
        { ...decision, action: 'deny' },
        { ...audit('denied'), id: 'approval-concurrent-audit-deny' },
      ),
    ])
    expect([approved.status, denied.status].sort()).toEqual(['fulfilled', 'rejected'])
    const concurrentAudits = (await harness.db.select({ id: agentAuditEvent.id }).from(agentAuditEvent)).filter((row) =>
      row.id.startsWith('approval-concurrent-audit-'),
    )
    expect(concurrentAudits).toHaveLength(1)
  })

  it('allows only one controller to claim an unowned Agent through concurrent approval requests [spec: agent-identity/agent-management-authority]', async () => {
    const competingUserId = await createUser(harness, adminCookie, {
      email: 'competing-owner@example.com',
      username: 'competingowner',
      displayName: 'Competing Owner',
      password: 'competing-owner-password-2026',
    })
    const createdAt = new Date('2026-07-29T00:00:00.000Z')
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
    await harness.db.insert(agentHost).values({
      id: 'controller-claim-host',
      name: 'Controller Claim Host',
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    })
    await harness.db.insert(agent).values({
      id: 'controller-claim-agent',
      name: 'Controller Claim Agent',
      hostId: 'controller-claim-host',
      status: 'pending',
      mode: 'delegated',
      publicKey: '{"kty":"OKP","crv":"Ed25519","x":"controller-claim"}',
      createdAt,
      updatedAt: createdAt,
    })
    await harness.db.insert(approvalRequest).values([
      {
        id: 'controller-claim-first',
        method: 'device_authorization',
        agentId: 'controller-claim-agent',
        hostId: 'controller-claim-host',
        status: 'pending',
        userCodeHash: await hashApprovalCode('CLAIM-1111'),
        interval: 5,
        expiresAt,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: 'controller-claim-second',
        method: 'device_authorization',
        agentId: 'controller-claim-agent',
        hostId: 'controller-claim-host',
        status: 'pending',
        userCodeHash: await hashApprovalCode('CLAIM-2222'),
        interval: 5,
        expiresAt,
        createdAt,
        updatedAt: createdAt,
      },
    ])

    const decide = (claimUserId: string, userCodeHash: string, auditId: string) =>
      harness.deps.agents.decideApproval(
        {
          agentId: 'controller-claim-agent',
          userCodeHash,
          userId: claimUserId,
          action: 'approve',
          now: new Date(),
        },
        agentGovernanceAuditRecord(auditId, {
          action: 'agent.capability_decided',
          result: 'allowed',
          tenant: { type: 'user', id: claimUserId },
          controllerUserId: claimUserId,
        }),
      )
    const outcomes = await Promise.allSettled([
      decide(userId, await hashApprovalCode('CLAIM-1111'), 'controller-claim-audit-first'),
      decide(competingUserId, await hashApprovalCode('CLAIM-2222'), 'controller-claim-audit-second'),
    ])
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected'])

    const [[claimedAgent], [claimedHost], requests, audits] = await Promise.all([
      harness.db.select().from(agent).where(eq(agent.id, 'controller-claim-agent')),
      harness.db.select().from(agentHost).where(eq(agentHost.id, 'controller-claim-host')),
      harness.db.select().from(approvalRequest),
      harness.db.select({ id: agentAuditEvent.id }).from(agentAuditEvent),
    ])
    expect([userId, competingUserId]).toContain(claimedAgent.userId)
    expect(claimedHost.userId).toBe(claimedAgent.userId)
    expect(
      requests.filter((request) => request.id.startsWith('controller-claim-') && request.status === 'approved'),
    ).toHaveLength(1)
    expect(audits.filter((row) => row.id.startsWith('controller-claim-audit-'))).toHaveLength(1)
  })

  it(`enrolls a stable identity, adds and revokes hosts, recovers, toggles, and soft-deletes it
      [spec: agent-identity/agent-identity-enrollment]
      [spec: agent-identity/agent-multi-host-continuity]
      [spec: agent-identity/agent-host-revocation]
      [spec: agent-identity/agent-identity-recovery]
      [spec: agent-identity/agent-identity-deletion]
      [spec: agent-identity/public-agent-profile]
      [spec: agent-identity/agent-stable-issuer]`, async () => {
    const first = await seedAgent(harness, userId, 'identity-first')
    const firstIntent = await createIntent(harness, userId, {
      name: 'Release Agent',
      protocolAgentId: first.agentId,
    })
    const approved = await approveIntent(harness, ownerCookie, firstIntent.id)

    expect(approved.agent).toMatchObject({
      issuer: 'http://localhost/api/auth',
      username: 'agent-identity-first',
      name: 'Release Agent',
      status: 'active',
      homeSpace: { type: 'personal', userId },
    })
    const stableSubject = approved.agent.subject

    const publicProfile = await harness.request(`/api/public/agents/${encodeURIComponent(stableSubject)}?view=full`)
    expect(publicProfile.status, await publicProfile.clone().text()).toBe(200)
    await expect(publicProfile.json()).resolves.toMatchObject({
      type: 'agent',
      view: 'full',
      issuer: 'http://localhost/api/auth',
      subject: stableSubject,
      name: 'Release Agent',
      owner: { type: 'user', id: userId, username: 'identityowner', displayName: 'Identity Owner' },
      activity: { total: expect.any(Number) },
      activityDays: expect.any(Array),
      recentActivity: expect.any(Array),
    })

    const usernameProfile = await harness.request(
      `/api/public/agents/${encodeURIComponent(approved.agent.username)}?view=summary`,
    )
    expect(usernameProfile.status, await usernameProfile.clone().text()).toBe(200)
    await expect(usernameProfile.json()).resolves.toMatchObject({
      subject: stableSubject,
      username: approved.agent.username,
    })

    const second = await seedAgent(harness, userId, 'identity-second')
    const reservationKey = 'second-installation-enrollment'
    const firstReservation = await createAdditionalAgentEnrollmentIntent(
      harness.deps,
      approved.agent.id,
      second.agentId,
      userId,
      reservationKey,
    )
    const replayedReservation = await createAdditionalAgentEnrollmentIntent(
      harness.deps,
      approved.agent.id,
      second.agentId,
      userId,
      reservationKey,
    )
    expect(firstReservation.replayed).toBe(false)
    expect(replayedReservation).toMatchObject({ intent: { id: firstReservation.intent.id }, replayed: true })
    const secondIntent = firstReservation.intent
    const multiHost = await approveIntent(harness, ownerCookie, secondIntent.id)
    expect(multiHost.agent.subject).toBe(stableSubject)
    const activeBindings = await harness.db
      .select()
      .from(agentIdentityBinding)
      .where(eq(agentIdentityBinding.agentIdentityId, approved.agent.id))
    expect(activeBindings.filter((binding) => binding.status === 'active')).toHaveLength(2)

    const recover = await harness.request(`/api/account/agents/${approved.agent.id}/recovery`, {
      method: 'POST',
      headers: { cookie: ownerCookie },
    })
    expect(recover.status).toBe(202)
    const [inactive] = await harness.db.select().from(agentIdentity).where(eq(agentIdentity.id, approved.agent.id))
    expect(inactive).toMatchObject({ subject: stableSubject, status: 'inactive' })

    const replacement = await seedAgent(harness, userId, 'identity-replacement')
    const replacementIntent = await createIntent(harness, userId, {
      agentIdentityId: approved.agent.id,
      protocolAgentId: replacement.agentId,
    })
    const recovered = await approveIntent(harness, ownerCookie, replacementIntent.id)
    expect(recovered.agent).toMatchObject({ subject: stableSubject, status: 'inactive' })

    const activate = await harness.request(`/api/account/agents/${approved.agent.id}/activation`, {
      method: 'PUT',
      headers: { cookie: ownerCookie },
    })
    expect(activate.status).toBe(204)

    const deletion = await harness.request(`/api/account/agents/${approved.agent.id}`, {
      method: 'DELETE',
      headers: { cookie: ownerCookie },
    })
    expect(deletion.status).toBe(204)
    const [deleted] = await harness.db.select().from(agentIdentity).where(eq(agentIdentity.id, approved.agent.id))
    const bindings = await harness.db
      .select()
      .from(agentIdentityBinding)
      .where(eq(agentIdentityBinding.agentIdentityId, approved.agent.id))
    expect(deleted).toMatchObject({ subject: stableSubject, status: 'inactive' })
    expect(deleted.deletedAt).toBeInstanceOf(Date)
    expect(bindings.some((binding) => binding.status === 'active')).toBe(false)

    const deletedProfile = await harness.request(`/api/public/agents/${encodeURIComponent(stableSubject)}`)
    expect(deletedProfile.status).toBe(404)
    const deletedDetail = await harness.request(`/api/account/agents/${approved.agent.id}`, {
      headers: { cookie: ownerCookie },
    })
    expect(deletedDetail.status).toBe(404)
  })

  it('rejects anonymous Agent enrollment', async () => {
    expect(
      (
        await harness.request('/api/agent/enrollments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'No Session' }),
        })
      ).status,
    ).toBe(401)
  })

  it(`uses one access request and grant flow for a native API
      [spec: agent-identity/native-api-resource-registration]
      [spec: agent-identity/native-api-resource-access-request]
      [spec: agent-identity/native-api-resource-token]
      [spec: agent-identity/agent-resource-grant-policy]`, async () => {
    const seeded = await seedAgent(harness, userId, 'token')
    const intent = await createIntent(harness, userId, {
      name: 'Token Agent',
      protocolAgentId: seeded.agentId,
      organizationId: platformOrganizationId,
    })
    const approved = await approveIntent(harness, ownerCookie, intent.id)
    harness.deps.externalHttp.fetch = resourceOpenApiFetch('https://api.example.com', 'repo:read')
    const resource = await createResource(harness.deps, {
      identifier: 'native-api',
      resourceUrl: 'https://api.example.com',
      accessMode: 'realmroot',
      ownerOrganizationId: platformOrganizationId,
    })
    const automaticScope = await harness.request(`/api/resource-servers/${resource.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({ scopeGrantModes: [{ scope: 'repo:read', grantMode: 'automatic' }] }),
    })
    expect(automaticScope.status, await automaticScope.clone().text()).toBe(200)
    const principal = {
      issuer: approved.agent.issuer,
      subject: approved.agent.subject,
      identityId: approved.agent.id,
      protocolAgentId: seeded.agentId,
      hostId: seeded.hostId,
    }

    const discovery = await listAgentResourceServers(
      harness.deps,
      principal,
      { limit: 20, offset: 0 },
      'http://localhost',
    )
    expect(discovery.items).toEqual([
      expect.objectContaining({
        id: resource.id,
        description: 'Read private code repositories',
        connection: { status: 'not_required', displayName: null, authorizedScopes: [] },
      }),
      expect.objectContaining({
        id: realmrootResourceServerId,
        identifier: 'realmroot',
        resourceUrl: 'http://localhost/api',
        connection: expect.objectContaining({ status: 'not_required' }),
      }),
    ])

    const accessRequest = await createAccessRequest(
      harness.deps,
      {
        resourceServerId: resource.id,
        scopes: ['repo:read'],
        reason: 'Read repositories',
      },
      principal,
      'http://localhost',
    )
    expect(accessRequest).toMatchObject({ resourceServerId: resource.id, authorizationDetails: [] })
    expect(accessRequest).not.toHaveProperty('grantId')

    const invalidApproval = await harness.request(`/api/account/access-requests/${accessRequest.id}/decision`, {
      method: 'PUT',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({ decision: 'approve', mode: 'persistent', authorizationDetails: null }),
    })
    expect(invalidApproval.status).toBe(400)

    const approval = await harness.request(`/api/account/access-requests/${accessRequest.id}/decision`, {
      method: 'PUT',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({ decision: 'approve', mode: 'persistent' }),
    })
    expect(approval.status, await approval.clone().text()).toBe(200)
    expect(await approval.json()).not.toHaveProperty('grantId')
    const tokenUrl = `http://localhost/api/access-requests/${accessRequest.id}/credentials`
    const proof = await createDpopProof('POST', tokenUrl, 'native-token-proof')
    const issued = await createAccessRequestCredential(
      harness.deps,
      accessRequest.id,
      proof.compact,
      tokenUrl,
      principal,
      harness.agentTokenSigner,
    )
    expect(issued).toMatchObject({
      tokenType: 'DPoP',
      scopes: ['repo:read'],
      resourceUrl: 'https://api.example.com',
    })
    const jwksResponse = await harness.request('/api/auth/jwks')
    expect(jwksResponse.status).toBe(200)
    const jwks = (await jwksResponse.json()) as { keys: Array<JWK & { alg: string }> }
    const verified = await jwtVerify(issued.accessToken, await importJWK(jwks.keys[0]!, jwks.keys[0]!.alg), {
      issuer: 'http://localhost/api/auth',
      audience: 'https://api.example.com',
    })
    expect(verified.payload).toMatchObject({
      sub: platformOrganizationId,
      scope: 'repo:read',
      cnf: { jkt: expect.any(String) },
      act: {
        iss: 'http://localhost/api/auth',
        sub: approved.agent.subject,
        sub_profile: 'ai_agent',
      },
    })
    expect(decodeProtectedHeader(issued.accessToken)).toMatchObject({
      alg: jwks.keys[0]!.alg,
      kid: jwks.keys[0]!.kid,
      typ: 'at+jwt',
    })
    await expect(
      createAccessRequestCredential(
        harness.deps,
        accessRequest.id,
        proof.compact,
        tokenUrl,
        principal,
        harness.agentTokenSigner,
      ),
    ).rejects.toMatchObject({ status: 400 })
  })
})

function resourceOpenApiFetch(resourceUrl: string, scope: string) {
  return async (request: Request) => {
    if (request.url.includes('/.well-known/oauth-protected-resource')) {
      return Response.json({ resource: resourceUrl, scopes_supported: [scope] })
    }
    if (request.url === new URL(resourceUrl).toString()) {
      return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
    }
    if (request.url === new URL('/openapi.json', resourceUrl).toString()) {
      return Response.json({
        openapi: '3.1.0',
        info: { title: 'Native API', description: 'Read private code repositories', version: '1.0.0' },
        components: {
          securitySchemes: {
            oauth: {
              type: 'oauth2',
              flows: {
                clientCredentials: {
                  tokenUrl: 'https://api.example.com/token',
                  scopes: { [scope]: scope },
                },
              },
            },
          },
        },
        paths: {
          '/resource': {
            get: { security: [{ oauth: [scope] }], responses: {} },
          },
        },
      })
    }
    return new Response(null, { status: 404 })
  }
}

async function createIntent(
  harness: Harness,
  actorUserId: string,
  input: { name?: string; agentIdentityId?: string; protocolAgentId: string; organizationId?: string },
) {
  if (input.agentIdentityId) {
    const result = await createAdditionalAgentEnrollmentIntent(
      harness.deps,
      input.agentIdentityId,
      input.protocolAgentId,
      actorUserId,
      `${input.protocolAgentId}:${input.agentIdentityId}`,
    )
    return result.intent
  }
  if (!input.name) throw new Error('A new Agent enrollment requires a name.')
  const result = await createAgentEnrollmentIntent(
    harness.deps,
    {
      nickname: input.name,
      username: input.protocolAgentId,
      runtime: 'codex',
      protocolAgentId: input.protocolAgentId,
      organizationId: input.organizationId,
    },
    actorUserId,
    `${input.protocolAgentId}:new-identity`,
  )
  return result.intent
}

async function approveIntent(harness: Harness, cookie: string, intentId: string) {
  const response = await harness.request(`/api/account/agent-enrollments/${intentId}/decision`, {
    method: 'PUT',
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ kind: 'identity', decision: 'approve' }),
  })
  expect(response.status, await response.clone().text()).toBe(200)
  return (await response.json()) as {
    agent: {
      id: string
      issuer: string
      subject: string
      username: string
      status: string
    }
  }
}

function jsonHeaders(cookie: string) {
  return { 'content-type': 'application/json', cookie }
}

function hashApprovalCode(code: string) {
  const stripped = code.replaceAll(/[^A-Z0-9]/gi, '').toUpperCase()
  const normalized = stripped.length === 8 ? `${stripped.slice(0, 4)}-${stripped.slice(4)}` : code.toUpperCase()
  return sha256(normalized)
}

async function createDpopProof(
  method: string,
  url: string,
  jti: string,
  existingPrivateKey?: CryptoKey,
  existingPublicJwk?: JsonWebKey,
  accessToken?: string,
) {
  const keyPair = existingPrivateKey ? null : await generateKeyPair('ES256')
  const privateKey = existingPrivateKey ?? keyPair!.privateKey
  const publicJwk = existingPublicJwk ?? (await exportJWK(keyPair!.publicKey))
  const htu = new URL(url)
  htu.search = ''
  htu.hash = ''
  const claims: Record<string, string | number> = {
    jti,
    htm: method,
    htu: htu.toString(),
    iat: Math.floor(Date.now() / 1000),
  }
  if (accessToken) claims.ath = await sha256(accessToken)
  const compact = await new SignJWT(claims)
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
    .sign(privateKey)
  return {
    request: new Request(url, { method, headers: { dpop: compact } }),
    compact,
    privateKey,
    publicJwk,
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
