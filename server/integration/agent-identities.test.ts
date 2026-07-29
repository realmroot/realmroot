import { applyD1Migrations, env, reset } from 'cloudflare:test'
import {
  agent,
  agentCapabilityGrant,
  agentHost,
  agentIdentity,
  agentIdentityBinding,
  approvalRequest,
} from '@server/db/schema'
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

    const loginApproval = await harness.request('/api/account/agent-approvals/approval-agent/decisions', {
      method: 'POST',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({ userCode: 'ABCD-1234', action: 'approve' }),
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

    const capabilityApproval = await harness.request('/api/account/agent-approvals/approval-agent/decisions', {
      method: 'POST',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({
        userCode: 'WXYZ-5678',
        action: 'approve',
        capabilities: ['management:read'],
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
    const firstIntent = await createIntent(harness, ownerCookie, {
      name: 'Release Agent',
      protocolAgentId: first.agentId,
    })
    const approved = await approveIntent(harness, ownerCookie, firstIntent.id)

    expect(approved.identity).toMatchObject({
      issuer: 'http://localhost/api/auth',
      name: 'Release Agent',
      status: 'active',
      homeSpace: { type: 'personal', userId },
      bindings: [{ protocolAgentId: first.agentId, hostId: first.hostId, status: 'active' }],
    })
    const stableSubject = approved.identity.subject

    const second = await seedAgent(harness, userId, 'identity-second')
    const secondIntentResponse = await harness.request(
      `/api/account/agent-identities/${approved.identity.id}/enrollment-intents`,
      {
        method: 'POST',
        headers: jsonHeaders(ownerCookie),
        body: JSON.stringify({ protocolAgentId: second.agentId }),
      },
    )
    expect(secondIntentResponse.status, await secondIntentResponse.clone().text()).toBe(202)
    const secondIntent = (await secondIntentResponse.json()) as { id: string }
    const multiHost = await approveIntent(harness, ownerCookie, secondIntent.id)
    expect(multiHost.identity.subject).toBe(stableSubject)
    expect(multiHost.identity.bindings.filter((binding) => binding.status === 'active')).toHaveLength(2)

    const revoke = await harness.request(
      `/api/account/agent-identities/${approved.identity.id}/hosts/${first.agentId}`,
      { method: 'DELETE', headers: { cookie: ownerCookie } },
    )
    expect(revoke.status).toBe(204)
    const [revokedProtocolAgent] = await harness.db.select().from(agent).where(eq(agent.id, first.agentId))
    const [remainingProtocolAgent] = await harness.db.select().from(agent).where(eq(agent.id, second.agentId))
    expect(revokedProtocolAgent.status).toBe('revoked')
    expect(remainingProtocolAgent.status).toBe('active')

    const recover = await harness.request(`/api/account/agent-identities/${approved.identity.id}/recoveries`, {
      method: 'POST',
      headers: { cookie: ownerCookie },
    })
    expect(recover.status).toBe(202)
    const [recovering] = await harness.db.select().from(agentIdentity).where(eq(agentIdentity.id, approved.identity.id))
    expect(recovering).toMatchObject({ subject: stableSubject, status: 'recovering' })

    const replacement = await seedAgent(harness, userId, 'identity-replacement')
    const replacementIntentResponse = await harness.request(
      `/api/account/agent-identities/${approved.identity.id}/enrollment-intents`,
      {
        method: 'POST',
        headers: jsonHeaders(ownerCookie),
        body: JSON.stringify({ protocolAgentId: replacement.agentId }),
      },
    )
    const replacementIntent = (await replacementIntentResponse.json()) as { id: string }
    const recovered = await approveIntent(harness, ownerCookie, replacementIntent.id)
    expect(recovered.identity).toMatchObject({ subject: stableSubject, status: 'active' })

    const retire = await harness.request(`/api/account/agent-identities/${approved.identity.id}`, {
      method: 'DELETE',
      headers: { cookie: ownerCookie },
    })
    expect(retire.status).toBe(204)
    const [retired] = await harness.db.select().from(agentIdentity).where(eq(agentIdentity.id, approved.identity.id))
    const bindings = await harness.db
      .select()
      .from(agentIdentityBinding)
      .where(eq(agentIdentityBinding.agentIdentityId, approved.identity.id))
    expect(retired).toMatchObject({ subject: stableSubject, status: 'retired' })
    expect(retired.retiredAt).toBeInstanceOf(Date)
    expect(bindings.some((binding) => binding.status === 'active')).toBe(false)
  })

  it('rejects anonymous enrollment and duplicate protocol bindings', async () => {
    const seeded = await seedAgent(harness, userId, 'identity-boundary')
    expect(
      (
        await harness.request('/api/account/agent-enrollment-intents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'No Session', protocolAgentId: seeded.agentId }),
        })
      ).status,
    ).toBe(401)

    const intent = await createIntent(harness, ownerCookie, {
      name: 'Bound Agent',
      protocolAgentId: seeded.agentId,
    })
    await approveIntent(harness, ownerCookie, intent.id)
    const duplicate = await harness.request('/api/account/agent-enrollment-intents', {
      method: 'POST',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({ name: 'Duplicate', protocolAgentId: seeded.agentId }),
    })
    expect(duplicate.status).toBe(400)
  })

  it(`persists authority grants, atomically rejects proof replay, and invalidates issued tokens on revocation
      [spec: agent-identity/agent-autonomous-authority]
      [spec: agent-identity/agent-delegated-authority]
      [spec: agent-identity/agent-oidc-federation]
      [spec: agent-identity/agent-grant-policy]`, async () => {
    const seeded = await seedAgent(harness, userId, 'token')
    const intent = await createIntent(harness, ownerCookie, {
      name: 'Token Agent',
      protocolAgentId: seeded.agentId,
    })
    const approved = await approveIntent(harness, ownerCookie, intent.id)

    const grantResponse = await harness.request(
      `/api/account/agent-identities/${approved.identity.id}/authority-grants`,
      {
        method: 'POST',
        headers: jsonHeaders(ownerCookie),
        body: JSON.stringify({
          mode: 'autonomous',
          audience: 'https://api.example.com',
          scopes: ['repo:read', 'repo:write'],
        }),
      },
    )
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
      sub: approved.identity.subject,
      scope: 'repo:read repo:write',
      agent_identity: { iss: 'http://localhost/api/auth', sub: approved.identity.subject },
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

    const revoke = await harness.request(
      `/api/account/agent-identities/${approved.identity.id}/authority-grants/${grant.id}`,
      { method: 'DELETE', headers: { cookie: ownerCookie } },
    )
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

    const stepUpGrantResponse = await harness.request(
      `/api/account/agent-identities/${approved.identity.id}/authority-grants`,
      {
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
      },
    )
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
      `/api/account/agent-identities/${approved.identity.id}/authority-grants/${stepUpGrant.id}/approvals/${approvalId}`,
      { method: 'POST', headers: { cookie: ownerCookie } },
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

async function createIntent(harness: Harness, cookie: string, input: { name: string; protocolAgentId: string }) {
  const response = await harness.request('/api/account/agent-enrollment-intents', {
    method: 'POST',
    headers: jsonHeaders(cookie),
    body: JSON.stringify(input),
  })
  expect(response.status, await response.clone().text()).toBe(202)
  return (await response.json()) as { id: string }
}

async function approveIntent(harness: Harness, cookie: string, intentId: string) {
  const response = await harness.request(`/api/account/agent-enrollment-intents/${intentId}/approvals`, {
    method: 'POST',
    headers: { cookie },
  })
  expect(response.status, await response.clone().text()).toBe(201)
  return (await response.json()) as {
    identity: {
      id: string
      issuer: string
      subject: string
      status: string
      bindings: Array<{ protocolAgentId: string; hostId: string; status: string }>
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
