import { badRequest, forbidden, notFound, OAuthError, oauthError } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import type { AgentAuthorityGrant, AgentTokenRequest, CreateAgentAuthorityGrantRequest } from '@shared/api/agents'
import { calculateJwkThumbprint, decodeProtectedHeader, importJWK, type JWK, jwtVerify } from 'jose'

const accessTokenLifetimeSeconds = 5 * 60
const dpopProofLifetimeSeconds = 60
const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token' as const

interface ProtocolAgentSession {
  agentId: string
  agent: {
    id: string
    hostId: string
    mode: string
    capabilityGrants?: Array<{
      capability: string
      status: string
    }>
  }
  host: { id: string; userId: string | null; status: string } | null
}

export interface AgentTokenSigner {
  issuer: string
  sign(payload: Record<string, unknown>): Promise<string>
}

export interface AgentAccessTokenVerifier {
  issuer: string
  verify(token: string, audience: string): Promise<Record<string, unknown> | null>
}

export async function createAgentAuthorityGrant(
  deps: Deps,
  identityId: string,
  input: CreateAgentAuthorityGrantRequest,
  actorUserId: string,
): Promise<AgentAuthorityGrant> {
  const identity = await requireControlledIdentity(deps, identityId, actorUserId)
  if (identity.identity.status !== 'active') throw badRequest('Agent identity must be active.')
  const scopes = [...new Set(input.scopes)]
  if (scopes.length !== input.scopes.length) throw badRequest('Agent authority grant scopes must be unique.')
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
  if (expiresAt && expiresAt.getTime() <= Date.now())
    throw badRequest('Agent authority grant expiry must be in the future.')

  const subject =
    input.mode === 'autonomous'
      ? { type: 'agent', id: identity.identity.subject }
      : identity.identity.ownerUserId
        ? { type: 'user', id: identity.identity.ownerUserId }
        : { type: 'organization', id: identity.identity.ownerOrganizationId! }
  const now = new Date()
  return toGrant(
    await deps.agentTokens.createGrant({
      id: createId('aggrant'),
      agentIdentityId: identityId,
      mode: input.mode,
      subjectType: subject.type,
      subjectId: subject.id,
      audience: input.audience,
      scopes,
      constraints: input.constraints ?? null,
      useCount: 0,
      status: 'active',
      grantedByUserId: actorUserId,
      expiresAt,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    }),
  )
}

export async function listAgentAuthorityGrants(deps: Deps, identityId: string, actorUserId: string) {
  await requireControlledIdentity(deps, identityId, actorUserId)
  return { grants: (await deps.agentTokens.listGrants(identityId)).map(toGrant) }
}

export async function revokeAgentAuthorityGrant(deps: Deps, identityId: string, grantId: string, actorUserId: string) {
  await requireControlledIdentity(deps, identityId, actorUserId)
  const grant = await deps.agentTokens.findGrant(grantId)
  if (!grant || grant.agentIdentityId !== identityId) throw notFound('Agent authority grant was not found.')
  if (!(await deps.agentTokens.revokeGrant(grantId, new Date()))) {
    throw badRequest('Agent authority grant is already revoked.')
  }
}

export async function approveAgentAuthorityApproval(
  deps: Deps,
  identityId: string,
  grantId: string,
  approvalId: string,
  actorUserId: string,
) {
  await requireControlledIdentity(deps, identityId, actorUserId)
  const [grant, approval] = await Promise.all([
    deps.agentTokens.findGrant(grantId),
    deps.agentTokens.findApproval(approvalId),
  ])
  if (!grant || grant.agentIdentityId !== identityId || !approval || approval.grantId !== grantId) {
    throw notFound('Agent authority approval was not found.')
  }
  const approved = await deps.agentTokens.approveApproval(approvalId, actorUserId, new Date())
  if (!approved) throw badRequest('Agent authority approval is expired or no longer pending.')
  return approved
}

export async function issueAgentAccessToken(
  deps: Deps,
  request: Request,
  input: AgentTokenRequest,
  session: ProtocolAgentSession,
  signer: AgentTokenSigner,
) {
  const protocolAgentId = session.agent.id
  const identity = await deps.agentIdentities.findActiveByProtocolAgent(protocolAgentId)
  if (!identity) throw oauthError('invalid_grant', 'Agent registration is not bound to an active Agent identity.')
  if (identity.identity.issuer !== signer.issuer) {
    throw oauthError('invalid_grant', 'Agent identity does not belong to the active OAuth issuer.')
  }
  const binding = identity.bindings.find(
    (candidate) => candidate.protocolAgentId === protocolAgentId && candidate.status === 'active',
  )
  if (!binding || binding.hostId !== session.agent.hostId) {
    throw oauthError('invalid_grant', 'Agent host binding is not active.')
  }

  const grant = await deps.agentTokens.findGrant(input.grantId)
  if (
    !grant ||
    grant.agentIdentityId !== identity.identity.id ||
    grant.status !== 'active' ||
    (grant.expiresAt && grant.expiresAt.getTime() <= Date.now())
  ) {
    throw oauthError('invalid_grant', 'No active Agent authority grant permits this token.')
  }
  const requestedScopes = [...new Set(input.scope ? input.scope.split(/\s+/).filter(Boolean) : grant.scopes)].sort()
  if (requestedScopes.length === 0 || requestedScopes.some((scope) => !grant.scopes.includes(scope))) {
    throw oauthError('invalid_scope', 'Requested scope exceeds the Agent authority grant.')
  }
  const constraints = grant.constraints as {
    allowedHostIds?: string[]
    notBefore?: string
    maxUses?: number
    stepUpRequired?: boolean
  } | null
  if (constraints?.allowedHostIds && !constraints.allowedHostIds.includes(binding.hostId)) {
    throw oauthError('invalid_grant', 'Agent host is outside the authority grant.')
  }
  if (constraints?.notBefore && new Date(constraints.notBefore).getTime() > Date.now()) {
    throw oauthError('invalid_grant', 'Agent authority grant is not active yet.')
  }

  const proof = await verifyDpopProof(request)
  if (!(await consumeDpopProof(deps, proof))) throw invalidDpopToken('DPoP proof was already used.')
  if (constraints?.stepUpRequired) {
    if (!input.approvalId) {
      const now = new Date()
      const approval = await deps.agentTokens.createApproval({
        id: createId('agapproval'),
        grantId: grant.id,
        bindingId: binding.id,
        requestedScopes,
        status: 'pending',
        approvedByUserId: null,
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        approvedAt: null,
        consumedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      throw oauthError('approval_required', 'Controller approval is required.', 400, {
        approval_id: approval.id,
        expires_in: Math.max(0, Math.floor((approval.expiresAt.getTime() - now.getTime()) / 1000)),
        scope: requestedScopes.join(' '),
      })
    }
    if (
      !(await deps.agentTokens.consumeApproval(input.approvalId, grant.id, binding.id, requestedScopes, new Date()))
    ) {
      throw oauthError('invalid_grant', 'Step-up approval is invalid, expired, or already used.')
    }
  }
  if (constraints?.maxUses !== undefined && !(await deps.agentTokens.consumeGrantUse(grant.id, constraints.maxUses))) {
    throw oauthError('invalid_grant', 'Agent authority grant usage limit is exhausted.')
  }

  const now = new Date()
  const maximumExpiresAt = new Date(now.getTime() + accessTokenLifetimeSeconds * 1000)
  const expiresAt =
    grant.expiresAt && grant.expiresAt.getTime() < maximumExpiresAt.getTime() ? grant.expiresAt : maximumExpiresAt
  const tokenId = createId('agat')
  const delegated = grant.mode === 'delegated'
  const actor = authorityActor(identity.identity.issuer, identity.identity.subject, binding.hostId, delegated)
  const accessToken = await signer.sign({
    iss: signer.issuer,
    sub: delegated ? grant.subjectId : identity.identity.subject,
    aud: grant.audience,
    jti: tokenId,
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(expiresAt.getTime() / 1000),
    scope: requestedScopes.join(' '),
    client_id: protocolAgentId,
    cnf: { jkt: proof.keyThumbprint },
    act: actor,
    agent_identity: {
      iss: identity.identity.issuer,
      sub: identity.identity.subject,
    },
  })
  await deps.agentTokens.storeAccessToken({
    id: tokenId,
    tokenHash: await sha256(accessToken),
    agentIdentityId: identity.identity.id,
    bindingId: binding.id,
    protocolAgentId,
    grantId: grant.id,
    subjectIssuer: signer.issuer,
    subject: delegated ? grant.subjectId : identity.identity.subject,
    actor,
    audience: grant.audience,
    scopes: requestedScopes,
    confirmationJkt: proof.keyThumbprint,
    expiresAt,
    revokedAt: null,
    createdAt: now,
  })

  return {
    access_token: accessToken,
    issued_token_type: accessTokenType,
    token_type: 'DPoP' as const,
    expires_in: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
    scope: requestedScopes.join(' '),
  }
}

export async function authenticateAgentAccessToken(deps: Deps, request: Request, verifier: AgentAccessTokenVerifier) {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^DPoP\s+(.+)$/i)
  if (!match?.[1]) throw invalidDpopResource('A DPoP access token is required.')
  const rawToken = match[1]
  const token = await deps.agentTokens.findAccessTokenByHash(await sha256(rawToken))
  if (!token || token.revokedAt || token.expiresAt.getTime() <= Date.now())
    throw invalidDpopResource('Agent access token is invalid.')
  let header: ReturnType<typeof decodeProtectedHeader>
  try {
    header = decodeProtectedHeader(rawToken)
  } catch {
    throw invalidDpopResource('Agent access token is malformed.')
  }
  if (header.typ !== 'at+jwt' || header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw invalidDpopResource('Agent access token header is invalid.')
  }
  let payload: Record<string, unknown> | null
  try {
    payload = await verifier.verify(rawToken, token.audience)
  } catch {
    throw invalidDpopResource('Agent access token signature is invalid.')
  }
  const confirmation = payload?.cnf
  if (
    !payload ||
    payload.iss !== verifier.issuer ||
    token.subjectIssuer !== verifier.issuer ||
    payload.sub !== token.subject ||
    !audienceContains(payload.aud, token.audience) ||
    payload.jti !== token.id ||
    payload.client_id !== token.protocolAgentId ||
    payload.scope !== token.scopes.join(' ') ||
    !confirmation ||
    typeof confirmation !== 'object' ||
    Array.isArray(confirmation) ||
    (confirmation as Record<string, unknown>).jkt !== token.confirmationJkt ||
    payload.iat !== Math.floor(token.createdAt.getTime() / 1000) ||
    typeof payload.exp !== 'number' ||
    payload.exp !== Math.floor(token.expiresAt.getTime() / 1000) ||
    payload.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw invalidDpopResource('Agent access token claims are invalid.')
  }
  const [identity, grant] = await Promise.all([
    deps.agentIdentities.findActiveByProtocolAgent(token.protocolAgentId),
    deps.agentTokens.findGrant(token.grantId),
  ])
  const activeBinding = identity?.bindings.find(
    (binding) => binding.id === token.bindingId && binding.status === 'active',
  )
  if (
    identity?.identity.id !== token.agentIdentityId ||
    !activeBinding ||
    !grant ||
    grant.agentIdentityId !== token.agentIdentityId ||
    grant.audience !== token.audience ||
    token.scopes.some((scope) => !grant.scopes.includes(scope)) ||
    grant.subjectId !== token.subject ||
    grant.status !== 'active' ||
    (grant.expiresAt && grant.expiresAt.getTime() <= Date.now())
  ) {
    throw invalidDpopResource('Agent access token authority was revoked.')
  }
  const expectedActor = authorityActor(
    identity.identity.issuer,
    identity.identity.subject,
    activeBinding.hostId,
    grant.mode === 'delegated',
  )
  const stableIdentity = payload.agent_identity
  if (
    !stableIdentity ||
    typeof stableIdentity !== 'object' ||
    Array.isArray(stableIdentity) ||
    (stableIdentity as Record<string, unknown>).iss !== identity.identity.issuer ||
    (stableIdentity as Record<string, unknown>).sub !== identity.identity.subject ||
    !claimsEqual(token.actor, expectedActor) ||
    !claimsEqual(payload.act, expectedActor)
  ) {
    throw invalidDpopResource('Agent access token identity claims are invalid.')
  }
  const proof = await verifyDpopProof(request, rawToken)
  if (proof.keyThumbprint !== token.confirmationJkt) {
    throw invalidDpopResource('DPoP key does not match the access token.')
  }
  if (!(await consumeDpopProof(deps, proof))) throw invalidDpopResource('DPoP proof was already used.')
  return token
}

async function verifyDpopProof(request: Request, accessToken?: string) {
  const invalidProof = (description: string) =>
    accessToken ? invalidDpopResource(description, 'invalid_dpop_proof') : invalidDpopToken(description)
  const compact = request.headers.get('dpop')
  if (!compact) throw invalidProof('DPoP proof is required.')
  let header: ReturnType<typeof decodeProtectedHeader>
  try {
    header = decodeProtectedHeader(compact)
  } catch {
    throw invalidProof('DPoP proof is malformed.')
  }
  if (
    header.typ !== 'dpop+jwt' ||
    (header.alg !== 'EdDSA' && header.alg !== 'ES256') ||
    !header.jwk ||
    'd' in header.jwk
  ) {
    throw invalidProof('DPoP proof header is invalid.')
  }
  try {
    const jwk = header.jwk as JWK
    const key = await importJWK(jwk, header.alg)
    const { payload } = await jwtVerify(compact, key, {
      algorithms: [header.alg],
      clockTolerance: 5,
    })
    const now = Math.floor(Date.now() / 1000)
    if (
      typeof payload.jti !== 'string' ||
      typeof payload.iat !== 'number' ||
      Math.abs(now - payload.iat) > dpopProofLifetimeSeconds ||
      payload.htm !== request.method ||
      payload.htu !== dpopTarget(request.url)
    ) {
      throw invalidProof('DPoP proof claims do not match the request.')
    }
    if (accessToken) {
      if (payload.ath !== (await sha256(accessToken))) throw invalidProof('DPoP access token hash is invalid.')
    } else if (payload.ath !== undefined) {
      throw invalidProof('Token endpoint DPoP proof must not contain ath.')
    }
    return {
      jti: payload.jti,
      keyThumbprint: await calculateJwkThumbprint(jwk),
      expiresAt: new Date((payload.iat + dpopProofLifetimeSeconds + 5) * 1000),
    }
  } catch (error) {
    if (error instanceof OAuthError) throw error
    throw invalidProof('DPoP proof signature is invalid.')
  }
}

function invalidDpopToken(description: string) {
  return oauthError('invalid_dpop_proof', description)
}

function invalidDpopResource(description: string, error = 'invalid_token') {
  return oauthError(
    error,
    description,
    401,
    {},
    { 'WWW-Authenticate': `DPoP error="${error}", error_description="${description}"` },
  )
}

function audienceContains(value: unknown, audience: string) {
  return value === audience || (Array.isArray(value) && value.includes(audience))
}

function authorityActor(issuer: string, agentSubject: string, hostId: string, delegated: boolean) {
  return {
    iss: issuer,
    sub: hostId,
    actor_type: 'host',
    ...(delegated
      ? {
          act: {
            iss: issuer,
            sub: agentSubject,
            actor_type: 'agent',
          },
        }
      : {}),
  }
}

function claimsEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => claimsEqual(item, right[index]))
    )
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = Object.keys(leftRecord)
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every((key) => Object.hasOwn(rightRecord, key) && claimsEqual(leftRecord[key], rightRecord[key]))
  )
}

async function consumeDpopProof(deps: Deps, proof: { jti: string; keyThumbprint: string; expiresAt: Date }) {
  const createdAt = new Date()
  return deps.agentTokens.consumeDpopJti({
    jtiHash: await sha256(`${proof.keyThumbprint}:${proof.jti}`),
    keyThumbprint: proof.keyThumbprint,
    expiresAt: proof.expiresAt,
    createdAt,
  })
}

async function requireControlledIdentity(deps: Deps, identityId: string, actorUserId: string) {
  const identity = await deps.agentIdentities.findIdentity(identityId)
  if (!identity) throw notFound('Agent identity was not found.')
  if (identity.identity.ownerUserId === actorUserId) return identity
  if (identity.identity.ownerOrganizationId) {
    const member = await deps.authorization.findMemberByOrganizationUser(
      identity.identity.ownerOrganizationId,
      actorUserId,
    )
    if (member?.role === 'owner' || member?.role === 'admin') return identity
  }
  throw forbidden('Agent identity controller access is required.')
}

function toGrant(record: Awaited<ReturnType<Deps['agentTokens']['createGrant']>>): AgentAuthorityGrant {
  return {
    id: record.id,
    agentIdentityId: record.agentIdentityId,
    mode: record.mode as AgentAuthorityGrant['mode'],
    subjectType: record.subjectType as AgentAuthorityGrant['subjectType'],
    subjectId: record.subjectId,
    audience: record.audience,
    scopes: record.scopes,
    constraints: record.constraints,
    status: record.status as AgentAuthorityGrant['status'],
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function dpopTarget(rawUrl: string) {
  const url = new URL(rawUrl)
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return base64Url(new Uint8Array(digest))
}

function base64Url(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export type { ProtocolAgentSession }
