import { createTestDeps } from '@server/http/test-deps'
import {
  approveAgentAuthorityApproval,
  authenticateAgentAccessToken,
  createAgentAuthorityGrant,
  getAgentJwks,
  issueAgentAccessToken,
  listAgentAuthorityGrants,
  type ProtocolAgentSession,
  revokeAgentAuthorityGrant,
} from '@server/usecases/agent-tokens'
import type { Deps } from '@server/usecases/deps'
import type { AgentAccessTokenRecord, AgentAuthorityGrantRecord, AgentIdentityAggregate } from '@server/usecases/ports'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'

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
    await expect(issue(missingIdentity, 'missing-identity')).rejects.toMatchObject({ status: 403 })

    for (const aggregate of [
      identity({ bindings: [] }),
      identity({ bindings: [{ ...identity().bindings[0]!, status: 'revoked' }] }),
      identity({ bindings: [{ ...identity().bindings[0]!, hostId: 'other-host' }] }),
    ]) {
      const deps = await tokenDeps()
      vi.mocked(deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(aggregate)
      await expect(issue(deps, crypto.randomUUID())).rejects.toMatchObject({ status: 403 })
    }

    for (const invalidGrant of [
      null,
      grant({ agentIdentityId: 'other' }),
      grant({ status: 'revoked' }),
      grant({ expiresAt: new Date(Date.now() - 1) }),
    ]) {
      const deps = await tokenDeps()
      vi.mocked(deps.agentTokens.findGrant).mockResolvedValue(invalidGrant)
      await expect(issue(deps, crypto.randomUUID())).rejects.toMatchObject({ status: 403 })
    }
  })

  it('enforces scopes, host, activation time, step-up, and maximum-use constraints', async () => {
    const scope = await tokenDeps()
    await expect(issue(scope, 'empty-scope', { scope: '  ' })).rejects.toMatchObject({ status: 403 })
    await expect(issue(scope, 'scope-escalation', { scope: 'admin' })).rejects.toMatchObject({ status: 403 })

    const host = await tokenDeps({ allowedHostIds: ['other-host'] })
    await expect(issue(host, 'host')).rejects.toMatchObject({ status: 403 })
    const notBefore = await tokenDeps({ notBefore: new Date(Date.now() + 60_000).toISOString() })
    await expect(issue(notBefore, 'not-before')).rejects.toMatchObject({ status: 403 })

    const stepUp = await tokenDeps({ stepUpRequired: true })
    vi.mocked(stepUp.agentTokens.createApproval).mockResolvedValue(approval())
    await expect(issue(stepUp, 'step-up')).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('approval-1'),
    })
    vi.mocked(stepUp.agentTokens.consumeApproval).mockResolvedValue(false)
    await expect(issue(stepUp, 'bad-approval', { approvalId: 'approval-1' })).rejects.toMatchObject({ status: 403 })
    vi.mocked(stepUp.agentTokens.consumeApproval).mockResolvedValue(true)
    await expect(issue(stepUp, 'good-approval', { approvalId: 'approval-1' })).resolves.toMatchObject({
      token_type: 'DPoP',
    })

    const maxUses = await tokenDeps({ maxUses: 1 })
    vi.mocked(maxUses.agentTokens.consumeGrantUse).mockResolvedValue(false)
    await expect(issue(maxUses, 'max-uses')).rejects.toMatchObject({ status: 403 })
  })

  it('rejects missing, malformed, structurally invalid, mismatched, stale, and replayed DPoP proofs', async () => {
    const deps = await tokenDeps()
    const url = 'https://auth.example.com/api/agent/oauth2/token'
    await expect(
      issueAgentAccessToken(deps, new Request(url, { method: 'POST' }), { grantId: 'grant-1' }, session()),
    ).rejects.toMatchObject({ status: 401 })
    await expect(
      issueAgentAccessToken(
        deps,
        new Request(url, { method: 'POST', headers: { dpop: 'bad' } }),
        { grantId: 'grant-1' },
        session(),
      ),
    ).rejects.toMatchObject({ status: 401 })

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
        ),
      ).rejects.toMatchObject({ status: 401 })
    }

    vi.mocked(deps.agentTokens.consumeDpopJti).mockResolvedValue(false)
    await expect(issue(deps, 'replay')).rejects.toMatchObject({ status: 401 })
  })

  it('creates and reuses the Agent signing key for JWKS', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.agentTokens.createSigningKey).mockImplementation(async (record) => record)
    await expect(getAgentJwks(deps)).resolves.toMatchObject({
      keys: [{ kid: expect.stringMatching(/^agsig_/), alg: 'ES256', use: 'sig' }],
    })
    expect(deps.secrets.seal).toHaveBeenCalledWith(
      expect.stringContaining('"kty"'),
      expect.stringMatching(/^agent-signing-key:agsig_.+:private-jwk$/),
    )

    vi.mocked(deps.agentTokens.findSigningKey).mockResolvedValue({
      id: 'existing-key',
      algorithm: 'ES256',
      publicJwk: { kty: 'EC' },
      encryptedPrivateJwk: 'sealed',
      createdAt: new Date(),
    })
    await expect(getAgentJwks(deps)).resolves.toMatchObject({ keys: [{ kid: 'existing-key' }] })
  })
})

describe('Agent access token authentication', () => {
  it('accepts a live token with matching DPoP key and active authority', async () => {
    const fixture = await accessFixture()
    await expect(authenticateAgentAccessToken(fixture.deps, fixture.request)).resolves.toMatchObject({ id: 'token-1' })
  })

  it('rejects absent, unknown, revoked, expired, or authority-revoked access tokens', async () => {
    const base = await accessFixture()
    await expect(authenticateAgentAccessToken(base.deps, new Request(base.request.url))).rejects.toMatchObject({
      status: 401,
    })
    vi.mocked(base.deps.agentTokens.findAccessTokenByHash).mockResolvedValue(null)
    await expect(authenticateAgentAccessToken(base.deps, base.request)).rejects.toMatchObject({ status: 401 })

    for (const token of [
      { ...base.token, revokedAt: new Date() },
      { ...base.token, expiresAt: new Date(Date.now() - 1) },
    ]) {
      const fixture = await accessFixture()
      vi.mocked(fixture.deps.agentTokens.findAccessTokenByHash).mockResolvedValue(token)
      await expect(authenticateAgentAccessToken(fixture.deps, fixture.request)).rejects.toMatchObject({ status: 401 })
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
      await expect(authenticateAgentAccessToken(fixture.deps, fixture.request)).rejects.toMatchObject({ status: 401 })
    }
  })

  it('rejects missing ath, wrong ath, wrong proof key, and replay', async () => {
    for (const options of [{ omitAccessTokenHash: true }, { accessTokenHash: 'wrong' }, { differentProofKey: true }]) {
      const fixture = await accessFixture(options)
      await expect(authenticateAgentAccessToken(fixture.deps, fixture.request)).rejects.toMatchObject({ status: 401 })
    }
    const replay = await accessFixture()
    vi.mocked(replay.deps.agentTokens.consumeDpopJti).mockResolvedValue(false)
    await expect(authenticateAgentAccessToken(replay.deps, replay.request)).rejects.toMatchObject({ status: 401 })
  })
})

function lifecycleDeps() {
  return createTestDeps({
    authorization: { findMemberByOrganizationUser: vi.fn().mockResolvedValue(null) },
  })
}

async function tokenDeps(constraints: Record<string, unknown> | null = null) {
  const deps = createTestDeps()
  const { privateKey } = await generateKeyPair('ES256', { extractable: true })
  const privateJwk = await exportJWK(privateKey)
  vi.mocked(deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(identity())
  vi.mocked(deps.agentTokens.findGrant).mockResolvedValue(grant({ constraints }))
  vi.mocked(deps.agentTokens.findSigningKey).mockResolvedValue({
    id: 'signing-key-1',
    algorithm: 'ES256',
    publicJwk: {},
    encryptedPrivateJwk: 'sealed',
    createdAt: new Date(),
  })
  vi.mocked(deps.secrets.open).mockResolvedValue(JSON.stringify(privateJwk))
  return deps
}

async function issue(deps: Deps, jti: string, input: { scope?: string; approvalId?: string } = {}) {
  const url = 'https://auth.example.com/api/agent/oauth2/token'
  return issueAgentAccessToken(deps, await dpopRequest(url, 'POST', jti), { grantId: 'grant-1', ...input }, session())
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
  const accessToken = 'faat_access'
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const keyJwk = await exportJWK(publicKey)
  const thumbprint = await calculateJwkThumbprint(keyJwk)
  const proofPair = options.differentProofKey ? await generateKeyPair('ES256') : { publicKey, privateKey }
  const proofJwk = await exportJWK(proofPair.publicKey)
  const url = 'https://auth.example.com/api/agent/egress/account-1/v1/repos?limit=1'
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
  const token = accessTokenRecord({ confirmationJkt: thumbprint })
  vi.mocked(deps.agentTokens.findAccessTokenByHash).mockResolvedValue(token)
  vi.mocked(deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(identity())
  vi.mocked(deps.agentTokens.findGrant).mockResolvedValue(grant())
  return { deps, request, token }
}

function identity(
  overrides: Partial<AgentIdentityAggregate['identity']> & { bindings?: AgentIdentityAggregate['bindings'] } = {},
): AgentIdentityAggregate {
  const now = new Date()
  const { bindings, ...recordOverrides } = overrides
  return {
    identity: {
      id: 'identity-1',
      issuer: 'https://auth.example.com',
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
    subjectIssuer: 'https://auth.example.com',
    subject: 'agt_stable',
    actor: { actor_type: 'host', sub: 'host-1' },
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
