import { applyD1Migrations, env, reset } from 'cloudflare:test'
import {
  agent,
  agentCapabilityGrant,
  agentHost,
  agentIdentity,
  agentIdentityBinding,
  approvalRequest,
} from '@server/db/schema'
import { createAdditionalAgentEnrollmentIntent, createAgentEnrollmentIntent } from '@server/usecases/agent-identities'
import { authenticateAgentAccessToken, issueAgentAccessToken } from '@server/usecases/agent-tokens'
import { eq } from 'drizzle-orm'
import { decodeProtectedHeader, exportJWK, generateKeyPair, importJWK, type JWK, jwtVerify, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createUser, type Harness, seedAgent, signIn, signInAdmin } from './harness'

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
    ownerCookie = await signIn(harness, 'identity-owner@example.com', 'identity-owner-password-2026')
  })

  it('commits controller approval decisions through the FlareAuth account boundary [spec: agent-identity/agent-identity-enrollment] [spec: agent-identity/agent-management-authority]', async () => {
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
      capability: 'management:read',
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    })
    await harness.db.insert(approvalRequest).values({
      id: 'approval-management',
      method: 'device_authorization',
      agentId: 'approval-agent',
      hostId: 'approval-host',
      capabilities: 'management:read',
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
        permissions: ['management:read'],
      }),
    })
    expect(capabilityApproval.status, await capabilityApproval.clone().text()).toBe(200)

    const [[grant], [capabilityRequest]] = await Promise.all([
      harness.db.select().from(agentCapabilityGrant).where(eq(agentCapabilityGrant.id, 'approval-management-grant')),
      harness.db.select().from(approvalRequest).where(eq(approvalRequest.id, 'approval-management')),
    ])
    expect(grant).toMatchObject({ status: 'active', grantedBy: userId })
    expect(capabilityRequest.status).toBe('approved')
  })

  it(`enrolls a stable identity, adds and revokes hosts, recovers, and permanently retires it
      [spec: agent-identity/agent-identity-enrollment]
      [spec: agent-identity/agent-multi-host-continuity]
      [spec: agent-identity/agent-host-revocation]
      [spec: agent-identity/agent-identity-recovery]
      [spec: agent-identity/agent-identity-retirement]
      [spec: agent-identity/agent-stable-issuer]`, async () => {
    const first = await seedAgent(harness, userId, 'identity-first')
    const firstIntent = await createIntent(harness, userId, {
      name: 'Release Agent',
      protocolAgentId: first.agentId,
    })
    const approved = await approveIntent(harness, ownerCookie, firstIntent.id)

    expect(approved.agent).toMatchObject({
      issuer: 'http://localhost/api/auth',
      name: 'Release Agent',
      status: 'active',
      homeSpace: { type: 'personal', userId },
    })
    const stableSubject = approved.agent.subject

    const second = await seedAgent(harness, userId, 'identity-second')
    const secondIntent = await createIntent(harness, userId, {
      agentIdentityId: approved.agent.id,
      protocolAgentId: second.agentId,
    })
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
    const [recovering] = await harness.db.select().from(agentIdentity).where(eq(agentIdentity.id, approved.agent.id))
    expect(recovering).toMatchObject({ subject: stableSubject, status: 'recovering' })

    const replacement = await seedAgent(harness, userId, 'identity-replacement')
    const replacementIntent = await createIntent(harness, userId, {
      agentIdentityId: approved.agent.id,
      protocolAgentId: replacement.agentId,
    })
    const recovered = await approveIntent(harness, ownerCookie, replacementIntent.id)
    expect(recovered.agent).toMatchObject({ subject: stableSubject, status: 'active' })

    const retire = await harness.request(`/api/account/agents/${approved.agent.id}`, {
      method: 'DELETE',
      headers: { cookie: ownerCookie },
    })
    expect(retire.status).toBe(204)
    const [retired] = await harness.db.select().from(agentIdentity).where(eq(agentIdentity.id, approved.agent.id))
    const bindings = await harness.db
      .select()
      .from(agentIdentityBinding)
      .where(eq(agentIdentityBinding.agentIdentityId, approved.agent.id))
    expect(retired).toMatchObject({ subject: stableSubject, status: 'retired' })
    expect(retired.retiredAt).toBeInstanceOf(Date)
    expect(bindings.some((binding) => binding.status === 'active')).toBe(false)
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

  it(`persists authority grants, atomically rejects proof replay, and invalidates issued tokens on revocation
      [spec: agent-identity/agent-autonomous-authority]
      [spec: agent-identity/agent-delegated-authority]
      [spec: agent-identity/agent-oidc-federation]
      [spec: agent-identity/agent-grant-policy]`, async () => {
    const seeded = await seedAgent(harness, userId, 'token')
    const intent = await createIntent(harness, userId, {
      name: 'Token Agent',
      protocolAgentId: seeded.agentId,
    })
    const approved = await approveIntent(harness, ownerCookie, intent.id)

    const grantResponse = await harness.request(`/api/account/agents/${approved.agent.id}/access-grants`, {
      method: 'POST',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({
        mode: 'autonomous',
        audience: 'https://api.example.com',
        scopes: ['repo:read', 'repo:write'],
      }),
    })
    expect(grantResponse.status, await grantResponse.clone().text()).toBe(201)
    const grant = (await grantResponse.json()) as { id: string }

    const proof = await createDpopProof('POST', 'http://localhost/api/auth/oauth2/token', 'atomic-token-proof')
    const session = {
      agentId: seeded.agentId,
      agent: { id: seeded.agentId, hostId: seeded.hostId, mode: 'delegated' },
      host: { id: seeded.hostId, userId, status: 'active' },
    }
    const attempts = await Promise.allSettled([
      issueAgentAccessToken(harness.deps, proof.request, { grantId: grant.id }, session, harness.agentTokenSigner),
      issueAgentAccessToken(harness.deps, proof.request, { grantId: grant.id }, session, harness.agentTokenSigner),
    ])
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1)
    const issued = attempts.find((attempt) => attempt.status === 'fulfilled')
    if (!issued || issued.status !== 'fulfilled') throw new Error('expected one issued Agent access token')
    const jwksResponse = await harness.request('/api/auth/jwks')
    expect(jwksResponse.status).toBe(200)
    const jwks = (await jwksResponse.json()) as { keys: Array<JWK & { alg: string }> }
    const verified = await jwtVerify(issued.value.access_token, await importJWK(jwks.keys[0]!, jwks.keys[0]!.alg), {
      issuer: 'http://localhost/api/auth',
      audience: 'https://api.example.com',
    })
    expect(verified.payload).toMatchObject({
      sub: approved.agent.subject,
      scope: 'repo:read repo:write',
      agent_identity: { iss: 'http://localhost/api/auth', sub: approved.agent.subject },
      act: { sub: seeded.hostId, actor_type: 'host' },
    })
    expect(decodeProtectedHeader(issued.value.access_token)).toMatchObject({
      alg: jwks.keys[0]!.alg,
      kid: jwks.keys[0]!.kid,
      typ: 'at+jwt',
    })
    const oidcMetadata = await harness.request('/api/auth/.well-known/openid-configuration')
    expect(await oidcMetadata.json()).toMatchObject({
      issuer: 'http://localhost/api/auth',
      jwks_uri: 'http://localhost/api/auth/jwks',
      token_endpoint: 'http://localhost/api/auth/oauth2/token',
    })

    const revoke = await harness.request(`/api/account/agents/${approved.agent.id}/access-grants/${grant.id}`, {
      method: 'DELETE',
      headers: { cookie: ownerCookie },
    })
    expect(revoke.status).toBe(204)

    const resourceRequest = await createDpopProof(
      'GET',
      'https://api.example.com/repos',
      'resource-proof',
      proof.privateKey,
      proof.publicJwk,
      issued.value.access_token,
    )
    await expect(
      authenticateAgentAccessToken(
        harness.deps,
        new Request(resourceRequest.request.url, {
          headers: {
            authorization: `DPoP ${issued.value.access_token}`,
            dpop: resourceRequest.compact,
          },
        }),
        harness.agentAccessTokenVerifier,
      ),
    ).rejects.toMatchObject({ status: 401, message: 'Agent access token authority was revoked.' })

    const stepUpGrantResponse = await harness.request(`/api/account/agents/${approved.agent.id}/access-grants`, {
      method: 'POST',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({
        mode: 'autonomous',
        audience: 'https://high-risk.example.com',
        scopes: ['deploy:read', 'deploy:write'],
        constraints: {
          allowedHostIds: [seeded.hostId],
          maxUses: 1,
          stepUpRequired: true,
        },
      }),
    })
    const stepUpGrant = (await stepUpGrantResponse.json()) as { id: string }
    const initialStepUpProof = await createDpopProof(
      'POST',
      'http://localhost/api/auth/oauth2/token',
      'step-up-initial',
    )
    const stepUpError = await issueAgentAccessToken(
      harness.deps,
      initialStepUpProof.request,
      { grantId: stepUpGrant.id, scope: 'deploy:write' },
      session,
      harness.agentTokenSigner,
    ).catch((error: unknown) => error)
    expect(stepUpError).toMatchObject({ status: 400, error: 'approval_required' })
    const approvalId = (stepUpError as { parameters: { approval_id: string } }).parameters.approval_id
    expect(approvalId).toMatch(/^agapproval_/)

    const approve = await harness.request(
      `/api/account/agents/${approved.agent.id}/access-grants/${stepUpGrant.id}/approvals/${approvalId}/decision`,
      { method: 'PUT', headers: { cookie: ownerCookie } },
    )
    expect(approve.status, await approve.clone().text()).toBe(200)
    const broadenedProof = await createDpopProof(
      'POST',
      'http://localhost/api/auth/oauth2/token',
      'step-up-broadened',
      initialStepUpProof.privateKey,
      initialStepUpProof.publicJwk,
    )
    await expect(
      issueAgentAccessToken(
        harness.deps,
        broadenedProof.request,
        {
          grantId: stepUpGrant.id,
          approvalId,
          scope: 'deploy:read deploy:write',
        },
        session,
        harness.agentTokenSigner,
      ),
    ).rejects.toMatchObject({ status: 400, error: 'invalid_grant' })
    const approvedProof = await createDpopProof(
      'POST',
      'http://localhost/api/auth/oauth2/token',
      'step-up-approved',
      initialStepUpProof.privateKey,
      initialStepUpProof.publicJwk,
    )
    await expect(
      issueAgentAccessToken(
        harness.deps,
        approvedProof.request,
        { grantId: stepUpGrant.id, approvalId, scope: 'deploy:write' },
        session,
        harness.agentTokenSigner,
      ),
    ).resolves.toMatchObject({ token_type: 'DPoP', scope: 'deploy:write' })
    const replayApprovalProof = await createDpopProof(
      'POST',
      'http://localhost/api/auth/oauth2/token',
      'step-up-replay',
      initialStepUpProof.privateKey,
      initialStepUpProof.publicJwk,
    )
    await expect(
      issueAgentAccessToken(
        harness.deps,
        replayApprovalProof.request,
        { grantId: stepUpGrant.id, approvalId, scope: 'deploy:write' },
        session,
        harness.agentTokenSigner,
      ),
    ).rejects.toMatchObject({
      status: 400,
      error: 'invalid_grant',
      message: 'Step-up approval is invalid, expired, or already used.',
    })
  })
})

async function createIntent(
  harness: Harness,
  actorUserId: string,
  input: { name?: string; agentIdentityId?: string; protocolAgentId: string },
) {
  if (input.agentIdentityId) {
    return createAdditionalAgentEnrollmentIntent(
      harness.deps,
      input.agentIdentityId,
      input.protocolAgentId,
      actorUserId,
    )
  }
  if (!input.name) throw new Error('A new Agent enrollment requires a name.')
  return createAgentEnrollmentIntent(
    harness.deps,
    {
      name: input.name,
      protocolAgentId: input.protocolAgentId,
    },
    actorUserId,
  )
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
