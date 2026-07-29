import { badRequest, forbidden, notFound, unauthorized } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import type { AgentAuthorityGrant, AgentTokenRequest, CreateAgentAuthorityGrantRequest } from '@shared/api/agents'
import {
  calculateJwkThumbprint,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  importJWK,
  type JWK,
  jwtVerify,
  SignJWT,
} from 'jose'

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
) {
  const protocolAgentId = session.agent.id
  const identity = await deps.agentIdentities.findActiveByProtocolAgent(protocolAgentId)
  if (!identity) throw forbidden('Agent protocol registration is not bound to an active Agent identity.')
  const binding = identity.bindings.find(
    (candidate) => candidate.protocolAgentId === protocolAgentId && candidate.status === 'active',
  )
  if (!binding || binding.hostId !== session.agent.hostId) throw forbidden('Agent host binding is not active.')

  const grant = await deps.agentTokens.findGrant(input.grantId)
  if (
    !grant ||
    grant.agentIdentityId !== identity.identity.id ||
    grant.status !== 'active' ||
    (grant.expiresAt && grant.expiresAt.getTime() <= Date.now())
  ) {
    throw forbidden('No active Agent authority grant permits this token.')
  }
  const requestedScopes = input.scope ? input.scope.split(/\s+/).filter(Boolean) : grant.scopes
  if (requestedScopes.length === 0 || requestedScopes.some((scope) => !grant.scopes.includes(scope))) {
    throw forbidden('Requested scope exceeds the Agent authority grant.')
  }
  const constraints = grant.constraints as {
    allowedHostIds?: string[]
    notBefore?: string
    maxUses?: number
    stepUpRequired?: boolean
  } | null
  if (constraints?.allowedHostIds && !constraints.allowedHostIds.includes(binding.hostId)) {
    throw forbidden('Agent host is outside the authority grant.')
  }
  if (constraints?.notBefore && new Date(constraints.notBefore).getTime() > Date.now()) {
    throw forbidden('Agent authority grant is not active yet.')
  }

  const proof = await verifyDpopProof(request)
  if (!(await consumeDpopProof(deps, proof))) throw unauthorized('DPoP proof was already used.')
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
      throw forbidden(`Step-up approval is required: ${approval.id}`)
    }
    if (!(await deps.agentTokens.consumeApproval(input.approvalId, grant.id, binding.id, new Date()))) {
      throw forbidden('Step-up approval is invalid, expired, or already used.')
    }
  }
  if (constraints?.maxUses !== undefined && !(await deps.agentTokens.consumeGrantUse(grant.id, constraints.maxUses))) {
    throw forbidden('Agent authority grant usage limit is exhausted.')
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + accessTokenLifetimeSeconds * 1000)
  const tokenId = createId('agat')
  const delegated = grant.mode === 'delegated'
  const actor = delegated
    ? {
        iss: identity.identity.issuer,
        sub: identity.identity.subject,
        actor_type: 'agent',
        host: { sub: binding.hostId, actor_type: 'host' },
      }
    : {
        iss: identity.identity.issuer,
        sub: binding.hostId,
        actor_type: 'host',
      }
  const signingKey = await getAgentSigningKey(deps)
  const privateKey = await importJWK(
    JSON.parse(await deps.secrets.open(signingKey.encryptedPrivateJwk, agentSigningKeyContext(signingKey.id))) as JWK,
    signingKey.algorithm,
  )
  const accessToken = await new SignJWT({
    scope: requestedScopes.join(' '),
    client_id: protocolAgentId,
    cnf: { jkt: proof.keyThumbprint },
    act: actor,
    agent_identity: {
      iss: identity.identity.issuer,
      sub: identity.identity.subject,
    },
  })
    .setProtectedHeader({ typ: 'at+jwt', alg: signingKey.algorithm, kid: signingKey.id })
    .setIssuer(identity.identity.issuer)
    .setSubject(delegated ? grant.subjectId : identity.identity.subject)
    .setAudience(grant.audience)
    .setJti(tokenId)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(privateKey)
  await deps.agentTokens.storeAccessToken({
    id: tokenId,
    tokenHash: await sha256(accessToken),
    agentIdentityId: identity.identity.id,
    bindingId: binding.id,
    protocolAgentId,
    grantId: grant.id,
    subjectIssuer: identity.identity.issuer,
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
    expires_in: accessTokenLifetimeSeconds,
    scope: requestedScopes.join(' '),
  }
}

export async function getAgentJwks(deps: Deps) {
  const key = await getAgentSigningKey(deps)
  return {
    keys: [
      {
        ...key.publicJwk,
        kid: key.id,
        alg: key.algorithm,
        use: 'sig',
      },
    ],
  }
}

async function getAgentSigningKey(deps: Deps) {
  const existing = await deps.agentTokens.findSigningKey()
  if (existing) return existing
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
  const id = createId('agsig')
  return deps.agentTokens.createSigningKey({
    id,
    algorithm: 'ES256',
    publicJwk: (await exportJWK(publicKey)) as Record<string, unknown>,
    encryptedPrivateJwk: await deps.secrets.seal(
      JSON.stringify(await exportJWK(privateKey)),
      agentSigningKeyContext(id),
    ),
    createdAt: new Date(),
  })
}

export async function authenticateAgentAccessToken(deps: Deps, request: Request) {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^DPoP\s+(.+)$/i)
  if (!match?.[1]) throw unauthorized('A DPoP access token is required.')
  const rawToken = match[1]
  const token = await deps.agentTokens.findAccessTokenByHash(await sha256(rawToken))
  if (!token || token.revokedAt || token.expiresAt.getTime() <= Date.now())
    throw unauthorized('Agent access token is invalid.')
  const [identity, grant] = await Promise.all([
    deps.agentIdentities.findActiveByProtocolAgent(token.protocolAgentId),
    deps.agentTokens.findGrant(token.grantId),
  ])
  if (
    !identity?.bindings.some((binding) => binding.id === token.bindingId && binding.status === 'active') ||
    !grant ||
    grant.status !== 'active' ||
    (grant.expiresAt && grant.expiresAt.getTime() <= Date.now())
  ) {
    throw unauthorized('Agent access token authority was revoked.')
  }
  const proof = await verifyDpopProof(request, rawToken)
  if (proof.keyThumbprint !== token.confirmationJkt) throw unauthorized('DPoP key does not match the access token.')
  if (!(await consumeDpopProof(deps, proof))) throw unauthorized('DPoP proof was already used.')
  return token
}

async function verifyDpopProof(request: Request, accessToken?: string) {
  const compact = request.headers.get('dpop')
  if (!compact) throw unauthorized('DPoP proof is required.')
  let header: ReturnType<typeof decodeProtectedHeader>
  try {
    header = decodeProtectedHeader(compact)
  } catch {
    throw unauthorized('DPoP proof is malformed.')
  }
  if (
    header.typ !== 'dpop+jwt' ||
    (header.alg !== 'EdDSA' && header.alg !== 'ES256') ||
    !header.jwk ||
    'd' in header.jwk
  ) {
    throw unauthorized('DPoP proof header is invalid.')
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
      throw unauthorized('DPoP proof claims do not match the request.')
    }
    if (accessToken) {
      if (payload.ath !== (await sha256(accessToken))) throw unauthorized('DPoP access token hash is invalid.')
    } else if (payload.ath !== undefined) {
      throw unauthorized('Token endpoint DPoP proof must not contain ath.')
    }
    return {
      jti: payload.jti,
      keyThumbprint: await calculateJwkThumbprint(jwk),
      expiresAt: new Date((payload.iat + dpopProofLifetimeSeconds + 5) * 1000),
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'ApiError') throw error
    throw unauthorized('DPoP proof signature is invalid.')
  }
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

function agentSigningKeyContext(keyId: string) {
  return `agent-signing-key:${keyId}:private-jwk`
}

export type { ProtocolAgentSession }
