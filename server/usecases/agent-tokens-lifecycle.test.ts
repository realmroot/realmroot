import { createTestDeps } from '@server/http/test-deps'
import {
  approveAgentAuthorityApproval,
  authenticateAgentAccessToken,
  createAgentAuthorityGrant,
  issueAgentAccessToken,
  listAgentAuthorityGrants,
  type ProtocolAgentSession,
  revokeAgentAuthorityGrant,
} from '@server/usecases/agent-tokens'
import type { Deps } from '@server/usecases/deps'
import type { AgentAccessTokenRecord, AgentAuthorityGrantRecord, AgentIdentityAggregate } from '@server/usecases/ports'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'

const tokenIssuer = 'https://auth.example.com/api/auth'
const signer = { issuer: tokenIssuer, sign: vi.fn().mockResolvedValue('signed-agent-token') }

describe('Agent authority lifecycle', () => {
  it('creates autonomous, delegated-user, and delegated-organization grants', async () => {
    const deps = lifecycleDeps()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identity())
    vi.mocked(deps.agentTokens.createGrant).mockImplementation(async (record) => record)

    await expect(
      createAgentAuthorityGrant(
        deps,
        'identity-1',
        {
          mode: 'autonomous',
          audience: 'https://api.example.com',
          scopes: ['repo:read'],
          constraints: { allowedHostIds: ['host-1'] },
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        'user-1',
      ),
    ).resolves.toMatchObject({ subjectType: 'agent', subjectId: 'agt_stable', expiresAt: expect.any(Date) })
    await expect(
      createAgentAuthorityGrant(
        deps,
        'identity-1',
        { mode: 'delegated', audience: 'https://api.example.com', scopes: ['repo:read'] },
        'user-1',
      ),
    ).resolves.toMatchObject({ subjectType: 'user', subjectId: 'user-1', constraints: null, expiresAt: null })

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(
      identity({ ownerUserId: null, ownerOrganizationId: 'org-1' }),
    )
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue(member('admin'))
    await expect(
      createAgentAuthorityGrant(
        deps,
        'identity-1',
        { mode: 'delegated', audience: 'https://api.example.com', scopes: ['repo:read'] },
        'user-1',
      ),
    ).resolves.toMatchObject({ subjectType: 'organization', subjectId: 'org-1' })
  })

  it('rejects invalid identity control, state, scope duplication, and expiry', async () => {
    const deps = lifecycleDeps()
    const input = {
      mode: 'autonomous' as const,
      audience: 'https://api.example.com',
      scopes: ['repo:read'],
    }
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(null)
    await expect(createAgentAuthorityGrant(deps, 'identity-1', input, 'user-1')).rejects.toMatchObject({ status: 404 })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identity({ ownerUserId: 'other-user' }))
    await expect(createAgentAuthorityGrant(deps, 'identity-1', input, 'user-1')).rejects.toMatchObject({ status: 403 })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(
      identity({ ownerUserId: null, ownerOrganizationId: 'org-1' }),
    )
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue(member('member'))
    await expect(createAgentAuthorityGrant(deps, 'identity-1', input, 'user-1')).rejects.toMatchObject({ status: 403 })
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue(null)
    await expect(createAgentAuthorityGrant(deps, 'identity-1', input, 'user-1')).rejects.toMatchObject({ status: 403 })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identity({ status: 'retired' }))
    await expect(createAgentAuthorityGrant(deps, 'identity-1', input, 'user-1')).rejects.toMatchObject({ status: 400 })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identity())
    await expect(
      createAgentAuthorityGrant(deps, 'identity-1', { ...input, scopes: ['repo:read', 'repo:read'] }, 'user-1'),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      createAgentAuthorityGrant(
        deps,
        'identity-1',
        { ...input, expiresAt: new Date(Date.now() - 1).toISOString() },
        'user-1',
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('lists, revokes, and approves exact authority records', async () => {
    const deps = lifecycleDeps()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identity())
    vi.mocked(deps.agentTokens.listGrants).mockResolvedValue([grant()])
    await expect(listAgentAuthorityGrants(deps, 'identity-1', 'user-1')).resolves.toMatchObject({
      grants: [{ id: 'grant-1' }],
    })

    vi.mocked(deps.agentTokens.findGrant).mockResolvedValue(grant())
    vi.mocked(deps.agentTokens.revokeGrant).mockResolvedValue(true)
    await expect(revokeAgentAuthorityGrant(deps, 'identity-1', 'grant-1', 'user-1')).resolves.toBeUndefined()
    vi.mocked(deps.agentTokens.findApproval).mockResolvedValue(approval())
    vi.mocked(deps.agentTokens.approveApproval).mockResolvedValue(approval({ status: 'approved' }))
    await expect(
      approveAgentAuthorityApproval(deps, 'identity-1', 'grant-1', 'approval-1', 'user-1'),
    ).resolves.toMatchObject({ status: 'approved' })

    vi.mocked(deps.agentTokens.findGrant).mockResolvedValue(null)
    await expect(revokeAgentAuthorityGrant(deps, 'identity-1', 'missing', 'user-1')).rejects.toMatchObject({
      status: 404,
    })
    vi.mocked(deps.agentTokens.findGrant).mockResolvedValue(grant({ agentIdentityId: 'other' }))
    await expect(revokeAgentAuthorityGrant(deps, 'identity-1', 'grant-1', 'user-1')).rejects.toMatchObject({
      status: 404,
    })
    vi.mocked(deps.agentTokens.findGrant).mockResolvedValue(grant())
    vi.mocked(deps.agentTokens.revokeGrant).mockResolvedValue(false)
    await expect(revokeAgentAuthorityGrant(deps, 'identity-1', 'grant-1', 'user-1')).rejects.toMatchObject({
      status: 400,
    })
    vi.mocked(deps.agentTokens.findApproval).mockResolvedValue(null)
    await expect(
      approveAgentAuthorityApproval(deps, 'identity-1', 'grant-1', 'missing', 'user-1'),
    ).rejects.toMatchObject({ status: 404 })
    vi.mocked(deps.agentTokens.findApproval).mockResolvedValue(approval({ grantId: 'other' }))
    await expect(
      approveAgentAuthorityApproval(deps, 'identity-1', 'grant-1', 'approval-1', 'user-1'),
    ).rejects.toMatchObject({ status: 404 })
    vi.mocked(deps.agentTokens.findApproval).mockResolvedValue(approval())
    vi.mocked(deps.agentTokens.approveApproval).mockResolvedValue(null)
    await expect(
      approveAgentAuthorityApproval(deps, 'identity-1', 'grant-1', 'approval-1', 'user-1'),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('Agent token policy branches', () => {
  it('rejects missing identity, inactive host binding, and inactive authority', async () => {
    const missingIdentity = await tokenDeps()
    vi.mocked(missingIdentity.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(null)
    await expect(issue(missingIdentity, 'missing-identity')).rejects.toMatchObject({
      status: 400,
      error: 'invalid_grant',
    })

    for (const aggregate of [
      identity({ bindings: [] }),
      identity({ bindings: [{ ...identity().bindings[0]!, status: 'revoked' }] }),
      identity({ bindings: [{ ...identity().bindings[0]!, hostId: 'other-host' }] }),
    ]) {
      const deps = await tokenDeps()
      vi.mocked(deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(aggregate)
      await expect(issue(deps, crypto.randomUUID())).rejects.toMatchObject({ status: 400, error: 'invalid_grant' })
    }

    for (const invalidGrant of [
      null,
      grant({ agentIdentityId: 'other' }),
      grant({ status: 'revoked' }),
      grant({ expiresAt: new Date(Date.now() - 1) }),
    ]) {
      const deps = await tokenDeps()
      vi.mocked(deps.agentTokens.findGrant).mockResolvedValue(invalidGrant)
      await expect(issue(deps, crypto.randomUUID())).rejects.toMatchObject({ status: 400, error: 'invalid_grant' })
    }
  })

  it('enforces scopes, host, activation time, step-up, and maximum-use constraints', async () => {
    const scope = await tokenDeps()
    await expect(issue(scope, 'empty-scope', { scope: '  ' })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_scope',
    })
    await expect(issue(scope, 'scope-escalation', { scope: 'admin' })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_scope',
    })

    const host = await tokenDeps({ allowedHostIds: ['other-host'] })
    await expect(issue(host, 'host')).rejects.toMatchObject({ status: 400, error: 'invalid_grant' })
    const notBefore = await tokenDeps({ notBefore: new Date(Date.now() + 60_000).toISOString() })
    await expect(issue(notBefore, 'not-before')).rejects.toMatchObject({ status: 400, error: 'invalid_grant' })

    const stepUp = await tokenDeps({ stepUpRequired: true })
    vi.mocked(stepUp.agentTokens.createApproval).mockResolvedValue(approval())
    await expect(issue(stepUp, 'step-up')).rejects.toMatchObject({
      status: 400,
      error: 'approval_required',
      parameters: expect.objectContaining({ approval_id: 'approval-1' }),
    })
    vi.mocked(stepUp.agentTokens.consumeApproval).mockResolvedValue(false)
    await expect(issue(stepUp, 'bad-approval', { approvalId: 'approval-1' })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_grant',
    })
    vi.mocked(stepUp.agentTokens.consumeApproval).mockResolvedValue(true)
    await expect(issue(stepUp, 'good-approval', { approvalId: 'approval-1' })).resolves.toMatchObject({
      token_type: 'DPoP',
    })
    expect(stepUp.agentTokens.consumeApproval).toHaveBeenLastCalledWith(
      'approval-1',
      'grant-1',
      'binding-1',
      ['repo:read', 'repo:write'],
      expect.any(Date),
    )

    const maxUses = await tokenDeps({ maxUses: 1 })
    vi.mocked(maxUses.agentTokens.consumeGrantUse).mockResolvedValue(false)
    await expect(issue(maxUses, 'max-uses')).rejects.toMatchObject({ status: 400, error: 'invalid_grant' })
  })

  it('never issues an access token beyond the authority grant expiry', async () => {
    const deps = await tokenDeps()
    const grantExpiresAt = new Date(Date.now() + 20_000)
    vi.mocked(deps.agentTokens.findGrant).mockResolvedValue(grant({ expiresAt: grantExpiresAt }))
    signer.sign.mockClear()

    const response = await issue(deps, 'grant-expiry')
    const claims = signer.sign.mock.calls.at(-1)?.[0] as { exp: number }

    expect(claims.exp).toBe(Math.floor(grantExpiresAt.getTime() / 1000))
    expect(response.expires_in).toBeGreaterThan(0)
    expect(response.expires_in).toBeLessThanOrEqual(20)
    expect(deps.agentTokens.storeAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: grantExpiresAt }),
    )
  })

  it('rejects missing, malformed, structurally invalid, mismatched, stale, and replayed DPoP proofs [spec: agent-identity/agent-oauth-errors]', async () => {
    const deps = await tokenDeps()
    const url = 'https://auth.example.com/api/auth/oauth2/token'
    await expect(
      issueAgentAccessToken(deps, new Request(url, { method: 'POST' }), { grantId: 'grant-1' }, session(), signer),
    ).rejects.toMatchObject({ status: 400, error: 'invalid_dpop_proof' })
    await expect(
      issueAgentAccessToken(
        deps,
        new Request(url, { method: 'POST', headers: { dpop: 'bad' } }),
        { grantId: 'grant-1' },
        session(),
        signer,
      ),
    ).rejects.toMatchObject({ status: 400, error: 'invalid_dpop_proof' })

    for (const options of [
      { typ: 'JWT' },
      { methodClaim: 'GET' },
      { urlClaim: 'https://auth.example.com/wrong' },
      { issuedAt: Math.floor(Date.now() / 1000) - 120 },
      { accessTokenHash: 'unexpected' },
      { omitJti: true },
      { privateJwkInHeader: true },
    ]) {
      await expect(
        issueAgentAccessToken(
          deps,
          await dpopRequest(url, 'POST', crypto.randomUUID(), options),
          { grantId: 'grant-1' },
          session(),
          signer,
        ),
      ).rejects.toMatchObject({ status: 400, error: 'invalid_dpop_proof' })
    }

    vi.mocked(deps.agentTokens.consumeDpopJti).mockResolvedValue(false)
    await expect(issue(deps, 'replay')).rejects.toMatchObject({ status: 400, error: 'invalid_dpop_proof' })
  })
})

describe('Agent access token authentication', () => {
  it('accepts a live token with matching DPoP key and active authority', async () => {
    const fixture = await accessFixture()
    await expect(authenticateAgentAccessToken(fixture.deps, fixture.request, fixture.verifier)).resolves.toMatchObject({
      id: 'token-1',
    })
  })

  it('rejects absent, unknown, revoked, expired, or authority-revoked access tokens', async () => {
    const base = await accessFixture()
    await expect(
      authenticateAgentAccessToken(base.deps, new Request(base.request.url), base.verifier),
    ).rejects.toMatchObject({
      status: 401,
    })
    vi.mocked(base.deps.agentTokens.findAccessTokenByHash).mockResolvedValue(null)
    await expect(authenticateAgentAccessToken(base.deps, base.request, base.verifier)).rejects.toMatchObject({
      status: 401,
    })

    for (const token of [
      { ...base.token, revokedAt: new Date() },
      { ...base.token, expiresAt: new Date(Date.now() - 1) },
    ]) {
      const fixture = await accessFixture()
      vi.mocked(fixture.deps.agentTokens.findAccessTokenByHash).mockResolvedValue(token)
      await expect(authenticateAgentAccessToken(fixture.deps, fixture.request, fixture.verifier)).rejects.toMatchObject(
        { status: 401 },
      )
    }

    for (const configure of [
      (deps: Deps) => vi.mocked(deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(null),
      (deps: Deps) =>
        vi
          .mocked(deps.agentIdentities.findActiveByProtocolAgent)
          .mockResolvedValue(identity({ bindings: [{ ...identity().bindings[0]!, status: 'revoked' }] })),
      (deps: Deps) => vi.mocked(deps.agentTokens.findGrant).mockResolvedValue(null),
      (deps: Deps) => vi.mocked(deps.agentTokens.findGrant).mockResolvedValue(grant({ status: 'revoked' })),
      (deps: Deps) =>
        vi.mocked(deps.agentTokens.findGrant).mockResolvedValue(grant({ expiresAt: new Date(Date.now() - 1) })),
    ]) {
      const fixture = await accessFixture()
      configure(fixture.deps)
      await expect(authenticateAgentAccessToken(fixture.deps, fixture.request, fixture.verifier)).rejects.toMatchObject(
        { status: 401 },
      )
    }
  })

  it('rejects missing ath, wrong ath, wrong proof key, and replay', async () => {
    for (const options of [{ omitAccessTokenHash: true }, { accessTokenHash: 'wrong' }, { differentProofKey: true }]) {
      const fixture = await accessFixture(options)
      await expect(authenticateAgentAccessToken(fixture.deps, fixture.request, fixture.verifier)).rejects.toMatchObject(
        { status: 401 },
      )
    }
    const replay = await accessFixture()
    vi.mocked(replay.deps.agentTokens.consumeDpopJti).mockResolvedValue(false)
    await expect(authenticateAgentAccessToken(replay.deps, replay.request, replay.verifier)).rejects.toMatchObject({
      status: 401,
    })
  })

  it('rejects failed verification and JWT claims that diverge from persisted token state', async () => {
    const signature = await accessFixture()
    vi.mocked(signature.verifier.verify).mockRejectedValue(new Error('bad signature'))
    await expect(
      authenticateAgentAccessToken(signature.deps, signature.request, signature.verifier),
    ).rejects.toMatchObject({ status: 401, error: 'invalid_token' })

    for (const override of [
      { iss: 'https://attacker.example.com' },
      { aud: 'https://other.example.com' },
      { jti: 'other-token' },
      { client_id: 'other-agent' },
      { scope: 'admin' },
      { cnf: { jkt: 'other-key' } },
      { iat: Math.floor(Date.now() / 1000) + 60 },
      { exp: Math.floor(Date.now() / 1000) - 1 },
      { agent_identity: { iss: tokenIssuer, sub: 'other-agent' } },
      { act: { actor_type: 'host', sub: 'other-host' } },
    ]) {
      const fixture = await accessFixture()
      const claims = await fixture.verifier.verify('', '')
      vi.mocked(fixture.verifier.verify).mockResolvedValue({ ...claims, ...override })
      await expect(authenticateAgentAccessToken(fixture.deps, fixture.request, fixture.verifier)).rejects.toMatchObject(
        { status: 401, error: 'invalid_token' },
      )
    }
  })
})

function lifecycleDeps() {
  return createTestDeps({
    authorization: { findMemberByOrganizationUser: vi.fn().mockResolvedValue(null) },
  })
}

async function tokenDeps(constraints: Record<string, unknown> | null = null) {
  const deps = createTestDeps()
  vi.mocked(deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(identity())
  vi.mocked(deps.agentTokens.findGrant).mockResolvedValue(grant({ constraints }))
  return deps
}

async function issue(deps: Deps, jti: string, input: { scope?: string; approvalId?: string } = {}) {
  const url = 'https://auth.example.com/api/auth/oauth2/token'
  return issueAgentAccessToken(
    deps,
    await dpopRequest(url, 'POST', jti),
    { grantId: 'grant-1', ...input },
    session(),
    signer,
  )
}

function session(): ProtocolAgentSession {
  return {
    agentId: 'protocol-agent-1',
    agent: { id: 'protocol-agent-1', hostId: 'host-1', mode: 'delegated' },
    host: { id: 'host-1', userId: 'user-1', status: 'active' },
  }
}

async function dpopRequest(
  url: string,
  method: string,
  jti: string,
  options: {
    typ?: string
    methodClaim?: string
    urlClaim?: string
    issuedAt?: number
    accessTokenHash?: string
    omitAccessTokenHash?: boolean
    omitJti?: boolean
    privateJwkInHeader?: boolean
    authorization?: string
  } = {},
) {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
  const jwk = options.privateJwkInHeader ? await exportJWK(privateKey) : await exportJWK(publicKey)
  const payload = {
    ...(options.omitJti ? {} : { jti }),
    htm: options.methodClaim ?? method,
    htu: options.urlClaim ?? dpopTarget(url),
    iat: options.issuedAt ?? Math.floor(Date.now() / 1000),
    ...(options.omitAccessTokenHash
      ? {}
      : options.accessTokenHash === undefined
        ? {}
        : { ath: options.accessTokenHash }),
  }
  const proof = await new SignJWT(payload)
    .setProtectedHeader({ typ: options.typ ?? 'dpop+jwt', alg: 'ES256', jwk })
    .sign(privateKey)
  return new Request(url, {
    method,
    headers: {
      dpop: proof,
      ...(options.authorization ? { authorization: options.authorization } : {}),
    },
  })
}

async function accessFixture(
  options: { omitAccessTokenHash?: boolean; accessTokenHash?: string; differentProofKey?: boolean } = {},
) {
  const deps = createTestDeps()
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const keyJwk = await exportJWK(publicKey)
  const thumbprint = await calculateJwkThumbprint(keyJwk)
  const token = accessTokenRecord({ confirmationJkt: thumbprint })
  const claims = {
    iss: tokenIssuer,
    sub: token.subject,
    aud: token.audience,
    jti: token.id,
    client_id: token.protocolAgentId,
    scope: token.scopes.join(' '),
    cnf: { jkt: thumbprint },
    iat: Math.floor(token.createdAt.getTime() / 1000),
    exp: Math.floor(token.expiresAt.getTime() / 1000),
    act: token.actor,
    agent_identity: { iss: tokenIssuer, sub: 'agt_stable' },
  }
  const accessToken = compactJwt(claims)
  const proofPair = options.differentProofKey ? await generateKeyPair('ES256') : { publicKey, privateKey }
  const proofJwk = await exportJWK(proofPair.publicKey)
  const url = 'https://projects.example.com/api/projects?limit=1'
  const proof = await new SignJWT({
    jti: crypto.randomUUID(),
    htm: 'GET',
    htu: dpopTarget(url),
    iat: Math.floor(Date.now() / 1000),
    ...(options.omitAccessTokenHash ? {} : { ath: options.accessTokenHash ?? (await digest(accessToken)) }),
  })
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: proofJwk })
    .sign(proofPair.privateKey)
  const request = new Request(url, {
    headers: { authorization: `DPoP ${accessToken}`, dpop: proof },
  })
  vi.mocked(deps.agentTokens.findAccessTokenByHash).mockResolvedValue(token)
  vi.mocked(deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(identity())
  vi.mocked(deps.agentTokens.findGrant).mockResolvedValue(grant())
  return {
    deps,
    request,
    token,
    verifier: {
      issuer: tokenIssuer,
      verify: vi.fn().mockResolvedValue(claims),
    },
  }
}

function identity(
  overrides: Partial<AgentIdentityAggregate['identity']> & { bindings?: AgentIdentityAggregate['bindings'] } = {},
): AgentIdentityAggregate {
  const now = new Date()
  const { bindings, ...recordOverrides } = overrides
  return {
    identity: {
      id: 'identity-1',
      issuer: tokenIssuer,
      subject: 'agt_stable',
      name: 'Agent',
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
      status: 'active',
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
      ...recordOverrides,
    },
    bindings: bindings ?? [
      {
        id: 'binding-1',
        agentIdentityId: 'identity-1',
        protocolAgentId: 'protocol-agent-1',
        hostId: 'host-1',
        status: 'active',
        boundAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  }
}

function grant(overrides: Partial<AgentAuthorityGrantRecord> = {}): AgentAuthorityGrantRecord {
  const now = new Date()
  return {
    id: 'grant-1',
    agentIdentityId: 'identity-1',
    mode: 'autonomous',
    subjectType: 'agent',
    subjectId: 'agt_stable',
    audience: 'https://api.example.com',
    scopes: ['repo:read', 'repo:write'],
    constraints: null,
    useCount: 0,
    status: 'active',
    grantedByUserId: 'user-1',
    expiresAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function approval(overrides: Record<string, unknown> = {}) {
  const now = new Date()
  return {
    id: 'approval-1',
    grantId: 'grant-1',
    bindingId: 'binding-1',
    requestedScopes: ['repo:read'],
    status: 'pending',
    approvedByUserId: null,
    expiresAt: new Date(now.getTime() + 60_000),
    approvedAt: null,
    consumedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as never
}

function accessTokenRecord(overrides: Partial<AgentAccessTokenRecord> = {}): AgentAccessTokenRecord {
  const now = new Date()
  return {
    id: 'token-1',
    tokenHash: 'hash',
    agentIdentityId: 'identity-1',
    bindingId: 'binding-1',
    protocolAgentId: 'protocol-agent-1',
    grantId: 'grant-1',
    subjectIssuer: tokenIssuer,
    subject: 'agt_stable',
    actor: { iss: tokenIssuer, actor_type: 'host', sub: 'host-1' },
    audience: 'https://api.example.com',
    scopes: ['repo:read'],
    confirmationJkt: 'thumbprint',
    expiresAt: new Date(now.getTime() + 60_000),
    revokedAt: null,
    createdAt: now,
    ...overrides,
  }
}

function member(role: 'owner' | 'admin' | 'member') {
  return {
    id: 'member-1',
    organizationId: 'org-1',
    userId: 'user-1',
    role,
    title: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

function dpopTarget(rawUrl: string) {
  const url = new URL(rawUrl)
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function compactJwt(payload: Record<string, unknown>) {
  return `${encodeJwtPart({ typ: 'at+jwt', alg: 'RS256', kid: 'test' })}.${encodeJwtPart(payload)}.signature`
}

function encodeJwtPart(value: Record<string, unknown>) {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
