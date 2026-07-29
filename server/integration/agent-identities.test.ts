import { applyD1Migrations, env, reset } from 'cloudflare:test'
import {
  agent,
  agentAuditEvent,
  agentCapabilityGrant,
  agentHost,
  agentIdentity,
  agentIdentityBinding,
  approvalRequest,
  externalCredential,
} from '@server/db/schema'
import { authenticateAgentAccessToken, issueAgentAccessToken } from '@server/usecases/agent-tokens'
import { eq } from 'drizzle-orm'
import { exportJWK, generateKeyPair, importJWK, type JWK, jwtVerify, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
      issuer: 'http://localhost',
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

    const proof = await createDpopProof('POST', 'http://localhost/api/agent/oauth2/token', 'atomic-token-proof')
    const session = {
      agentId: seeded.agentId,
      agent: { id: seeded.agentId, hostId: seeded.hostId, mode: 'delegated' },
      host: { id: seeded.hostId, userId, status: 'active' },
    }
    const attempts = await Promise.allSettled([
      issueAgentAccessToken(harness.deps, proof.request, { grantId: grant.id }, session),
      issueAgentAccessToken(harness.deps, proof.request, { grantId: grant.id }, session),
    ])
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1)
    const issued = attempts.find((attempt) => attempt.status === 'fulfilled')
    if (!issued || issued.status !== 'fulfilled') throw new Error('expected one issued Agent access token')
    const jwksResponse = await harness.request('/api/agent/jwks')
    expect(jwksResponse.status).toBe(200)
    const jwks = (await jwksResponse.json()) as { keys: Array<JWK & { alg: string }> }
    const verified = await jwtVerify(issued.value.access_token, await importJWK(jwks.keys[0]!, 'ES256'), {
      issuer: 'http://localhost',
      audience: 'https://api.example.com',
    })
    expect(verified.payload).toMatchObject({
      sub: approved.identity.subject,
      scope: 'repo:read repo:write',
      agent_identity: { iss: 'http://localhost', sub: approved.identity.subject },
      act: { sub: seeded.hostId, actor_type: 'host' },
    })
    const oidcMetadata = await harness.request('/.well-known/openid-configuration')
    expect(await oidcMetadata.json()).toMatchObject({
      issuer: 'http://localhost',
      jwks_uri: 'http://localhost/api/agent/jwks',
      token_endpoint: 'http://localhost/api/agent/oauth2/token',
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
          scopes: ['deploy:write'],
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
      'http://localhost/api/agent/oauth2/token',
      'step-up-initial',
    )
    const stepUpError = await issueAgentAccessToken(
      harness.deps,
      initialStepUpProof.request,
      { grantId: stepUpGrant.id },
      session,
    ).catch((error: unknown) => error)
    expect(stepUpError).toMatchObject({ status: 403 })
    const approvalId = (stepUpError as Error).message.split(': ').at(-1)
    expect(approvalId).toMatch(/^agapproval_/)

    const approve = await harness.request(
      `/api/account/agent-identities/${approved.identity.id}/authority-grants/${stepUpGrant.id}/approvals/${approvalId}`,
      { method: 'POST', headers: { cookie: ownerCookie } },
    )
    expect(approve.status, await approve.clone().text()).toBe(200)
    const approvedProof = await createDpopProof(
      'POST',
      'http://localhost/api/agent/oauth2/token',
      'step-up-approved',
      initialStepUpProof.privateKey,
      initialStepUpProof.publicJwk,
    )
    await expect(
      issueAgentAccessToken(harness.deps, approvedProof.request, { grantId: stepUpGrant.id, approvalId }, session),
    ).resolves.toMatchObject({ token_type: 'DPoP', scope: 'deploy:write' })
    const replayApprovalProof = await createDpopProof(
      'POST',
      'http://localhost/api/agent/oauth2/token',
      'step-up-replay',
      initialStepUpProof.privateKey,
      initialStepUpProof.publicJwk,
    )
    await expect(
      issueAgentAccessToken(
        harness.deps,
        replayApprovalProof.request,
        { grantId: stepUpGrant.id, approvalId },
        session,
      ),
    ).rejects.toMatchObject({ status: 403, message: 'Step-up approval is invalid, expired, or already used.' })
  })

  it(`stores a generic Connector credential without exposing it and grants constrained use without changing ownership
      [spec: agent-identity/external-account-ownership]
      [spec: agent-identity/external-account-connection]
      [spec: agent-identity/external-account-secret-custody]
      [spec: agent-identity/external-account-credential-boundary]`, async () => {
    const connectorResponse = await harness.request('/api/management/connectors', {
      method: 'POST',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({
        providerType: 'generic_api',
        providerId: 'build-api',
        displayName: 'Build API',
        apiBaseUrl: 'https://build.example.com',
        credentialModes: ['header', 'bearer'],
        credentialHeaderName: 'X-API-Key',
        allowedMethods: ['GET', 'POST'],
        allowedPathPrefixes: ['/v1/builds'],
      }),
    })
    expect(connectorResponse.status, await connectorResponse.clone().text()).toBe(201)
    const connector = (await connectorResponse.json()) as { id: string }

    const seeded = await seedAgent(harness, userId, 'external-account')
    const intent = await createIntent(harness, ownerCookie, {
      name: 'Build Agent',
      protocolAgentId: seeded.agentId,
    })
    const approved = await approveIntent(harness, ownerCookie, intent.id)

    const accountResponse = await harness.request('/api/account/external-accounts', {
      method: 'POST',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({
        connectorId: connector.id,
        owner: { type: 'user' },
        displayName: 'Production Builds',
        credential: { kind: 'header', value: 'external-api-secret' },
      }),
    })
    expect(accountResponse.status, await accountResponse.clone().text()).toBe(201)
    const account = (await accountResponse.json()) as {
      id: string
      owner: { type: string; userId: string }
      credentialConfigured: boolean
      credentialKind: string
      value?: string
    }
    expect(account).toMatchObject({
      owner: { type: 'user', userId },
      credentialConfigured: true,
      credentialKind: 'header',
    })
    expect(account).not.toHaveProperty('value')
    const [storedCredential] = await harness.db
      .select()
      .from(externalCredential)
      .where(eq(externalCredential.externalAccountId, account.id))
    expect(storedCredential.encryptedPayload).toMatch(/^v1\./)
    expect(storedCredential.encryptedPayload).not.toContain('external-api-secret')

    const grantResponse = await harness.request(`/api/account/external-accounts/${account.id}/grants`, {
      method: 'POST',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({
        agentIdentityId: approved.identity.id,
        scopes: ['build:read'],
        allowedMethods: ['GET'],
        allowedPathPrefixes: ['/v1/builds'],
      }),
    })
    expect(grantResponse.status, await grantResponse.clone().text()).toBe(201)
    const externalGrant = (await grantResponse.json()) as { id: string }
    expect(externalGrant).toMatchObject({
      externalAccountId: account.id,
      agentIdentityId: approved.identity.id,
      allowedMethods: ['GET'],
      allowedPathPrefixes: ['/v1/builds'],
    })

    const authorityResponse = await harness.request(
      `/api/account/agent-identities/${approved.identity.id}/authority-grants`,
      {
        method: 'POST',
        headers: jsonHeaders(ownerCookie),
        body: JSON.stringify({
          mode: 'autonomous',
          audience: 'https://build.example.com',
          scopes: ['build:read'],
        }),
      },
    )
    const authority = (await authorityResponse.json()) as { id: string }
    const tokenProof = await createDpopProof('POST', 'http://localhost/api/agent/oauth2/token', 'egress-token-proof')
    const issued = await issueAgentAccessToken(
      harness.deps,
      tokenProof.request,
      { grantId: authority.id },
      {
        agentId: seeded.agentId,
        agent: { id: seeded.agentId, hostId: seeded.hostId, mode: 'delegated' },
        host: { id: seeded.hostId, userId, status: 'active' },
      },
    )
    const upstream = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://build.example.com/v1/builds/42?view=summary')
      expect(request.headers.get('x-api-key')).toBe('external-api-secret')
      expect(request.headers.get('authorization')).toBeNull()
      return Response.json({ build: 42 }, { headers: { 'x-ratelimit-remaining': '4' } })
    })
    harness.deps.externalHttp.fetch = upstream
    const egressUrl = `http://localhost/api/agent/egress/${account.id}/v1/builds/42?view=summary`
    const egressProof = await createDpopProof(
      'GET',
      egressUrl,
      'egress-resource-proof',
      tokenProof.privateKey,
      tokenProof.publicJwk,
      issued.access_token,
    )
    const egress = await harness.request(`/api/agent/egress/${account.id}/v1/builds/42?view=summary`, {
      headers: {
        authorization: `DPoP ${issued.access_token}`,
        dpop: egressProof.compact,
      },
    })
    expect(egress.status, await egress.clone().text()).toBe(200)
    await expect(egress.json()).resolves.toEqual({ build: 42 })
    expect(egress.headers.get('x-ratelimit-remaining')).toBe('4')
    expect(upstream).toHaveBeenCalledOnce()
    const [allowedAudit] = await harness.db.select().from(agentAuditEvent)
    expect(allowedAudit).toMatchObject({
      result: 'allowed',
      controllerUserId: userId,
      agentIdentityId: approved.identity.id,
      hostId: seeded.hostId,
      authorityGrantId: authority.id,
      externalAccountId: account.id,
      externalAccountGrantId: externalGrant.id,
      targetOrigin: 'https://build.example.com',
      targetPath: '/v1/builds/42',
      method: 'GET',
    })
    expect(JSON.stringify(allowedAudit)).not.toContain('external-api-secret')

    const revokeExternalGrant = await harness.request(
      `/api/account/external-accounts/${account.id}/grants/${externalGrant.id}`,
      { method: 'DELETE', headers: { cookie: ownerCookie } },
    )
    expect(revokeExternalGrant.status).toBe(204)
    const revokedProof = await createDpopProof(
      'GET',
      egressUrl,
      'egress-revoked-proof',
      tokenProof.privateKey,
      tokenProof.publicJwk,
      issued.access_token,
    )
    const revokedEgress = await harness.request(`/api/agent/egress/${account.id}/v1/builds/42?view=summary`, {
      headers: {
        authorization: `DPoP ${issued.access_token}`,
        dpop: revokedProof.compact,
      },
    })
    expect(revokedEgress.status).toBe(403)
    expect(upstream).toHaveBeenCalledOnce()

    const invalidCredential = await harness.request('/api/account/external-accounts', {
      method: 'POST',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({
        connectorId: connector.id,
        owner: { type: 'user' },
        displayName: 'Browser Session',
        credential: { kind: 'cookie', value: 'session=secret' },
      }),
    })
    expect(invalidCredential.status).toBe(400)

    const bearerAccount = await harness.request('/api/account/external-accounts', {
      method: 'POST',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({
        connectorId: connector.id,
        owner: { type: 'agent', agentIdentityId: approved.identity.id },
        displayName: 'Bearer Build Account',
        credential: { kind: 'bearer', token: 'bearer-secret' },
      }),
    })
    expect(bearerAccount.status, await bearerAccount.clone().text()).toBe(201)
    expect(await bearerAccount.json()).toMatchObject({
      owner: { type: 'agent', agentIdentityId: approved.identity.id },
      credentialKind: 'bearer',
      credentialConfigured: true,
    })

    const identityInventory = await harness.request('/api/management/agents/identity-inventory', {
      headers: { cookie: adminCookie },
    })
    expect(identityInventory.status).toBe(200)
    expect((await identityInventory.json()) as object).toMatchObject({
      identities: [expect.objectContaining({ id: approved.identity.id, subject: approved.identity.subject })],
    })
    const auditInventory = await harness.request('/api/management/agent-audit-events', {
      headers: { cookie: adminCookie },
    })
    const auditBody = (await auditInventory.json()) as { events: unknown[] }
    expect(auditBody.events).toHaveLength(2)
    expect(JSON.stringify(auditBody)).not.toContain('external-api-secret')

    const emergencyRetire = await harness.request(`/api/management/agent-identities/${approved.identity.id}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie },
    })
    expect(emergencyRetire.status).toBe(204)
  })

  it('connects an external account through generic OIDC discovery and OAuth code + PKCE', async () => {
    const externalFetch = vi.fn(async (request: Request) => {
      if (request.url === 'https://idp.example.com/.well-known/openid-configuration') {
        return Response.json({
          issuer: 'https://idp.example.com',
          authorization_endpoint: 'https://idp.example.com/oauth/authorize',
          token_endpoint: 'https://idp.example.com/oauth/token',
          userinfo_endpoint: 'https://idp.example.com/oauth/userinfo',
        })
      }
      if (request.url === 'https://idp.example.com/oauth/token') {
        expect(request.method).toBe('POST')
        expect(request.headers.get('authorization')).toMatch(/^Basic /)
        const body = await request.formData()
        expect(body.get('code_verifier')).toBeTruthy()
        expect([...body.values()]).not.toContain('oidc-client-secret')
        return Response.json({
          access_token: 'upstream-access-token',
          refresh_token: 'upstream-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid repo:read',
        })
      }
      if (request.url === 'https://idp.example.com/oauth/userinfo') {
        expect(request.headers.get('authorization')).toBe('Bearer upstream-access-token')
        return Response.json({ sub: 'external-subject-1' })
      }
      return new Response(null, { status: 404 })
    })
    harness.deps.externalHttp.fetch = externalFetch

    const connectorResponse = await harness.request('/api/management/connectors', {
      method: 'POST',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({
        providerType: 'generic_oauth',
        providerId: 'generic-build-oidc',
        displayName: 'Build OIDC',
        clientId: 'oidc-client',
        clientSecret: 'oidc-client-secret',
        issuer: 'https://idp.example.com',
        apiBaseUrl: 'https://api.idp.example.com',
        credentialModes: ['oauth'],
        allowedMethods: ['GET'],
        allowedPathPrefixes: ['/v1/repos'],
        scopes: ['openid', 'repo:read'],
      }),
    })
    expect(connectorResponse.status, await connectorResponse.clone().text()).toBe(201)
    const connector = (await connectorResponse.json()) as { id: string }

    const start = await harness.request('/api/account/external-oauth-intents', {
      method: 'POST',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({
        connectorId: connector.id,
        owner: { type: 'user' },
        displayName: 'OIDC Build Account',
      }),
    })
    expect(start.status, await start.clone().text()).toBe(201)
    const { authorizationUrl } = (await start.json()) as { authorizationUrl: string }
    const authorization = new URL(authorizationUrl)
    expect(authorization.origin + authorization.pathname).toBe('https://idp.example.com/oauth/authorize')
    expect(authorization.searchParams.get('response_type')).toBe('code')
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.searchParams.get('redirect_uri')).toBe('http://localhost/api/external-accounts/oauth/callback')
    const state = authorization.searchParams.get('state')
    expect(state).toBeTruthy()

    const callback = await harness.request(
      `/api/external-accounts/oauth/callback?state=${encodeURIComponent(state!)}&code=authorization-code`,
    )
    expect(callback.status, await callback.clone().text()).toBe(201)
    const account = (await callback.json()) as {
      id: string
      externalSubject: string
      credentialKind: string
      accessToken?: string
    }
    expect(account).toMatchObject({
      externalSubject: 'external-subject-1',
      credentialKind: 'oauth',
      credentialConfigured: true,
    })
    expect(account).not.toHaveProperty('accessToken')
    const [credential] = await harness.db
      .select()
      .from(externalCredential)
      .where(eq(externalCredential.externalAccountId, account.id))
    expect(credential.encryptedPayload).toMatch(/^v1\./)
    expect(credential.encryptedPayload).not.toContain('upstream-access-token')
    expect(credential.encryptedPayload).not.toContain('upstream-refresh-token')

    const replay = await harness.request(
      `/api/external-accounts/oauth/callback?state=${encodeURIComponent(state!)}&code=authorization-code`,
    )
    expect(replay.status).toBe(400)
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
