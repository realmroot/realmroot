import { ApiError, badRequest, conflict, forbidden, notFound } from '@server/domain/errors'
import { agentGovernanceAuditRecord, appendAgentGovernanceAudit } from '@server/usecases/agent-audit'
import type { Deps } from '@server/usecases/deps'
import { revokeAgentResourceAccess, revokeAgentResourceLeasesForBinding } from '@server/usecases/external-resources'
import { organizationUserHasScope } from '@server/usecases/organization-membership-scopes'
import type {
  AgentAuditEventRecord,
  AgentAuthorityInventoryScope,
  AgentEnrollmentIntentRecord,
  AgentHostRecord,
  AgentIdentityAggregate,
  AgentIdentityBindingRecord,
  AgentIdentityRecord,
  AgentRecord,
} from '@server/usecases/ports'
import { resourceScopeEntitlementLifecycle } from '@server/usecases/resource-scope-entitlements'
import type { Agent, AgentEnrollment, CreateAgent, ListAgentPermissionsQuery } from '@shared/api/agent-api'
import type {
  AgentEnrollmentIntent,
  AgentHomeSpace,
  AgentIdentity,
  CreateAgentEnrollmentIntentRequest,
} from '@shared/api/agents'
import type { ListAuthorizedResourceServersQuery } from '@shared/api/authorization'
import { type PaginationInput, paginationInput, paginationMetadata, repositoryPageQuery } from '@shared/api/pagination'
import { importJWK } from 'jose'

const enrollmentLifetimeMs = 10 * 60 * 1000

export async function listPersonalAgentIdentities(deps: Deps, userId: string): Promise<{ items: AgentIdentity[] }> {
  return { items: (await deps.agentIdentities.listPersonal(userId)).map(toIdentity) }
}

export async function listPersonalAgents(deps: Deps, userId: string, page: PaginationInput) {
  const agents = (await deps.agentIdentities.listPersonal(userId)).map(toAgent)
  return {
    items: agents.slice(page.offset, page.offset + page.limit),
    pagination: paginationMetadata({ ...page, total: agents.length }),
  }
}

export async function getPersonalAgent(deps: Deps, agentId: string, actorUserId: string): Promise<Agent> {
  return toAgent(await requireControlledIdentity(deps, agentId, actorUserId))
}

export async function getAgent(deps: Deps, agentId: string): Promise<Agent> {
  return toAgent(await requireIdentity(deps, agentId))
}

export async function listOrganizationAgentIdentities(
  deps: Deps,
  organizationId: string,
  actorUserId: string,
): Promise<{ items: AgentIdentity[] }> {
  await assertController(deps, { type: 'organization', organizationId }, actorUserId)
  return { items: (await deps.agentIdentities.listOrganization(organizationId)).map(toIdentity) }
}

export async function listAllAgentIdentities(deps: Deps, page: { limit: number; offset: number }) {
  const result = await deps.agentIdentities.listAll(page)
  return { items: result.items.map(toIdentity), total: result.total, ...page }
}

export async function listAllAgents(deps: Deps, page: PaginationInput, scope?: AgentAuthorityInventoryScope) {
  const result = scope ? await deps.agentIdentities.listOwned(scope, page) : await deps.agentIdentities.listAll(page)
  const summaries = await loadManagementSummaries(deps, result.items)
  return {
    items: result.items.map((aggregate) => toManagementAgent(aggregate, summaries)),
    pagination: paginationMetadata(result),
  }
}

export async function getManagementAgent(deps: Deps, agentId: string) {
  const aggregate = await requireIdentity(deps, agentId)
  const summaries = await loadManagementSummaries(deps, [aggregate])
  return { agent: toManagementAgent(aggregate, summaries) }
}

export async function createAgentWithInstallation(
  deps: Deps,
  input: CreateAgent,
  context: { applicationId: string; actorUserId: string; issuer: string; idempotencyKey: string },
): Promise<{ agent: Agent; replayed: boolean }> {
  if (input.installation.publicKey.kid !== undefined && input.installation.publicKey.kid !== input.installation.kid) {
    throw badRequest('The installation kid must match the public JWK kid.')
  }
  await importJWK(input.installation.publicKey as JsonWebKey, 'EdDSA').catch(() => {
    throw badRequest('The installation publicKey must be a valid Ed25519 verification JWK.')
  })
  const requestFingerprint = await applicationAgentCreationFingerprint(input, context)
  const existing = await deps.agentIdentities.findApplicationCreation(
    context.applicationId,
    context.actorUserId,
    context.idempotencyKey,
  )
  if (existing) {
    requireMatchingApplicationAgentCreation(existing.reservation.requestFingerprint, requestFingerprint)
    requireLiveApplicationAgent(existing.identity)
    return { agent: toAgent(existing.identity), replayed: true }
  }
  const legacyReplay = await replayLegacyApplicationAgent(deps, input, context, requestFingerprint)
  if (legacyReplay) return legacyReplay
  let created: Awaited<ReturnType<typeof createUuidV7ApplicationAgent>>
  try {
    created = await createUuidV7ApplicationAgent(deps, input, context, requestFingerprint)
  } catch (error) {
    const recovered = await recoverLegacyApplicationAgentAfterFailure(deps, input, context, requestFingerprint, error)
    if (recovered) return recovered
    throw error
  }
  requireMatchingApplicationAgentCreation(created.reservation.requestFingerprint, requestFingerprint)
  requireLiveApplicationAgent(created.identity)
  return { agent: toAgent(created.identity), replayed: !created.created }
}

async function createUuidV7ApplicationAgent(
  deps: Deps,
  input: CreateAgent,
  context: { applicationId: string; actorUserId: string; issuer: string; idempotencyKey: string },
  requestFingerprint: string,
) {
  await requireAvailableAgentInstallation(deps, input)
  await requireAvailableAgentUsername(deps, input.username)
  const now = new Date()
  const ids = managedAgentIds(deps)
  const publicKey = canonicalJson(input.installation.publicKey)
  const identity = newAgentIdentityRecord({
    id: ids.identityId,
    subject: ids.subject,
    issuer: context.issuer,
    username: input.username,
    name: input.name,
    runtime: input.runtime,
    homeSpace: { type: 'personal', userId: context.actorUserId },
    now,
  })
  const host: AgentHostRecord = {
    id: input.installation.hostId,
    name: input.installation.name,
    userId: context.actorUserId,
    defaultCapabilities: JSON.stringify([]),
    publicKey,
    kid: input.installation.kid,
    jwksUrl: null,
    enrollmentTokenHash: null,
    enrollmentTokenExpiresAt: null,
    status: 'active',
    activatedAt: now,
    expiresAt: null,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  const protocolAgent: AgentRecord = {
    id: input.installation.agentId,
    name: input.name,
    userId: context.actorUserId,
    hostId: host.id,
    status: 'active',
    mode: 'delegated',
    publicKey,
    kid: input.installation.kid,
    jwksUrl: null,
    lastUsedAt: null,
    activatedAt: now,
    expiresAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  }
  return deps.agentIdentities.createAgentWithInstallation({
    host,
    protocolAgent,
    identity,
    binding: newAgentIdentityBinding({
      id: ids.bindingId,
      identityId: identity.id,
      protocolAgentId: protocolAgent.id,
      now,
    }),
    audit: agentGovernanceAuditRecord(ids.auditId, {
      action: 'agent.identity_enrolled',
      result: 'allowed',
      tenant: { type: 'user', id: context.actorUserId },
      controllerUserId: context.actorUserId,
      issuer: identity.issuer,
      subject: identity.subject,
      agentIdentityId: identity.id,
      hostId: host.id,
      metadata: { source: 'application', applicationId: context.applicationId },
    }),
    reservation: {
      id: ids.reservationId,
      applicationId: context.applicationId,
      actorUserId: context.actorUserId,
      idempotencyKey: context.idempotencyKey,
      requestFingerprint,
      agentIdentityId: identity.id,
      createdAt: now,
    },
  })
}

async function requireAvailableAgentInstallation(deps: Deps, input: CreateAgent) {
  const [existingProtocolAgent, existingHosts] = await Promise.all([
    deps.agentIdentities.findProtocolAgent(input.installation.agentId),
    deps.agents.listHostsForAgents([input.installation.hostId]),
  ])
  if (existingProtocolAgent || existingHosts.length > 0) {
    throw conflict('The Agent installation identifiers are already in use.')
  }
}

export async function listManagementAgentInstallations(deps: Deps, agentId: string, page: PaginationInput) {
  const aggregate = await requireIdentity(deps, agentId)
  const allBindings = [...aggregate.bindings].sort(
    (left, right) => right.boundAt.getTime() - left.boundAt.getTime() || right.id.localeCompare(left.id),
  )
  const bindings = allBindings.slice(page.offset, page.offset + page.limit)
  const hosts = await deps.agents.listHostsForAgents([...new Set(bindings.map((binding) => binding.hostId))])
  const hostsById = new Map(hosts.map((host) => [host.id, host]))
  return {
    items: bindings.map((binding) => {
      const host = hostsById.get(binding.hostId)
      if (!host) throw new Error(`Agent Host ${binding.hostId} was not found for its stable identity binding.`)
      if (!host.jwksUrl && !host.publicKey) throw new Error(`Agent Host ${host.id} has no authentication credential.`)
      return {
        id: binding.id,
        name: host.name ?? host.id,
        status: binding.status,
        credentialType: host.jwksUrl ? ('remote_jwks' as const) : ('public_key' as const),
        boundAt: binding.boundAt.toISOString(),
        lastSeenAt: host.lastUsedAt?.toISOString() ?? null,
      }
    }),
    pagination: paginationMetadata({ ...page, total: allBindings.length }),
  }
}

export async function listManagementAgentPermissions(
  deps: Deps,
  query: ListAgentPermissionsQuery & { agentId: string },
  scope?: AgentAuthorityInventoryScope,
) {
  const result = await deps.externalResources.listAgentPermissions(repositoryPageQuery(query), scope)
  return {
    items: result.items.map(({ entitlement, resource }) => ({
      id: entitlement.id,
      agentId: entitlement.agentIdentityId!,
      target: {
        type: 'api-resource' as const,
        apiResourceId: entitlement.resourceServerId,
        ...(entitlement.connectionId ? { accountConnectionId: entitlement.connectionId } : {}),
      },
      resource,
      scope: entitlement.scope,
      authorizationDetails: entitlement.authorizationDetails,
      mode: entitlement.mode,
      ...resourceScopeEntitlementLifecycle(entitlement),
      sourceAccessRequestId: entitlement.sourceAccessRequestId,
      expiresAt: entitlement.expiresAt?.toISOString() ?? null,
      endedAt: entitlement.endedAt?.toISOString() ?? null,
      createdAt: entitlement.createdAt.toISOString(),
      updatedAt: entitlement.updatedAt.toISOString(),
      links: {
        self: `/api/agents/${encodeURIComponent(entitlement.agentIdentityId!)}/permissions/${encodeURIComponent(entitlement.id)}`,
      },
    })),
    pagination: paginationMetadata(result),
  }
}

export async function getManagementAgentPermission(deps: Deps, entitlementId: string) {
  const entitlement = await deps.externalResources.findEntitlement(entitlementId)
  if (!entitlement?.agentIdentityId) throw notFound('Agent Permission was not found.')
  await requireIdentity(deps, entitlement.agentIdentityId)
  const result = await listManagementAgentPermissions(deps, {
    agentId: entitlement.agentIdentityId,
    resourceServerId: entitlement.resourceServerId,
    ...(resourceScopeEntitlementLifecycle(entitlement).status === 'ended' ? { status: 'inactive' as const } : {}),
    page: 1,
    pageSize: 100,
  })
  const projected = result.items.find((item) => item.id === entitlement.id)
  if (!projected) throw notFound('Agent Permission was not found.')
  return projected
}

export async function listManagementAgentAuthorizedResourceServers(
  deps: Deps,
  agentId: string,
  query: ListAuthorizedResourceServersQuery,
) {
  await requireIdentity(deps, agentId)
  return deps.authorization.listAuthorizedResourceServers(
    { type: 'agent', id: agentId },
    {
      ...(query.search ? { search: query.search } : {}),
      ...paginationInput(query),
    },
    new Date(),
  )
}

export async function getAgentIdentityByProtocolAgent(deps: Deps, protocolAgentId: string): Promise<AgentIdentity> {
  const identity = await deps.agentIdentities.findActiveByProtocolAgent(protocolAgentId)
  if (!identity) throw notFound('The Agent does not have an active stable identity.')
  return toIdentity(identity)
}

export async function createAgentLoginIdentity(
  deps: Deps,
  input: { protocolAgentId: string; username: string; nickname?: string; runtime: string },
  issuer: string,
  controllerUserId: string,
): Promise<AgentIdentity> {
  const existing = await deps.agentIdentities.findActiveByProtocolAgent(input.protocolAgentId)
  if (existing) return toIdentity(await requireOrClaimIdentityProfile(deps, existing, input))

  await assertProtocolAgentCanEnroll(deps, input.protocolAgentId, controllerUserId)

  const now = new Date()
  await requireAvailableAgentUsername(deps, input.username)
  const identityId = deps.ids.generate()
  const nickname = input.nickname ?? input.runtime
  const aggregate = await deps.agentIdentities.createIdentity({
    identity: newAgentIdentityRecord({
      id: identityId,
      subject: deps.ids.generate(),
      issuer,
      username: input.username,
      name: nickname,
      runtime: input.runtime,
      homeSpace: { type: 'personal', userId: controllerUserId },
      now,
    }),
    binding: newAgentIdentityBinding({
      id: deps.ids.generate(),
      identityId,
      protocolAgentId: input.protocolAgentId,
      now,
    }),
  })
  await appendIdentityAudit(deps, 'agent.identity_enrolled', aggregate, controllerUserId)
  return toIdentity(aggregate)
}

export async function getAgentEnrollmentIntent(
  deps: Deps,
  intentId: string,
  actorUserId: string,
): Promise<AgentEnrollmentIntent> {
  const intent = await deps.agentIdentities.findIntent(intentId)
  if (!intent) throw notFound('Agent enrollment intent was not found.')
  await assertController(deps, homeSpaceOf(intent), actorUserId)
  return toIntent(intent)
}

export async function getPublicAgentEnrollment(
  deps: Deps,
  enrollmentId: string,
  actorUserId: string,
): Promise<AgentEnrollment> {
  const intent = await getAgentEnrollmentIntent(deps, enrollmentId, actorUserId)
  return toAgentEnrollment(intent, await enrollmentAgentProfile(deps, intent))
}

export async function getProtocolAgentEnrollment(
  deps: Deps,
  enrollmentId: string,
  protocolAgentId: string,
): Promise<AgentEnrollment> {
  const intent = await deps.agentIdentities.findIntent(enrollmentId)
  if (!intent) throw notFound('Agent enrollment was not found.')
  if (intent.protocolAgentId !== protocolAgentId) throw forbidden('This Agent cannot read the enrollment.')
  const enrollmentIntent = toIntent(intent)
  return toAgentEnrollment(enrollmentIntent, await enrollmentAgentProfile(deps, enrollmentIntent))
}

export async function emergencyDeleteAgentIdentity(deps: Deps, identityId: string, actorUserId: string | null) {
  const identity = await requireIdentity(deps, identityId)
  if (!(await deps.agentIdentities.deleteIdentity(identityId, new Date()))) {
    throw notFound('Agent identity was not found.')
  }
  await revokeAgentResourceAccess(deps, identityId)
  await appendIdentityAudit(deps, 'agent.identity_deleted', identity, actorUserId, { emergency: true })
}

export async function emergencyDeactivateAgentIdentity(deps: Deps, identityId: string, actorUserId: string | null) {
  const identity = await requireIdentity(deps, identityId)
  if (!(await deps.agentIdentities.deactivateIdentity(identityId, new Date(), false))) {
    throw notFound('Agent identity was not found.')
  }
  await appendIdentityAudit(deps, 'agent.identity_deactivated', identity, actorUserId, { emergency: true })
}

export async function emergencyActivateAgentIdentity(deps: Deps, identityId: string, actorUserId: string | null) {
  const identity = await requireIdentity(deps, identityId)
  if (identity.identity.status === 'active') return
  if (!(await deps.agentIdentities.activateIdentity(identityId, new Date()))) {
    throw badRequest('Agent identity requires a new installation before it can be activated.')
  }
  await appendIdentityAudit(deps, 'agent.identity_activated', identity, actorUserId, { emergency: true })
}

export async function createAgentEnrollmentIntent(
  deps: Deps,
  input: CreateAgentEnrollmentIntentRequest,
  actorUserId: string,
  idempotencyKey: string,
): Promise<{ intent: AgentEnrollmentIntent; replayed: boolean }> {
  const profile = {
    username: input.username,
    nickname: input.nickname ?? input.runtime,
    runtime: input.runtime,
  }
  const homeSpace = input.organizationId
    ? ({ type: 'organization', organizationId: input.organizationId } as const)
    : ({ type: 'personal', userId: actorUserId } as const)
  const existing = await deps.agentIdentities.findIntentByIdempotencyKey(input.protocolAgentId, idempotencyKey)
  if (existing) {
    const profiledIntent = existing.requestedUsername
      ? existing
      : {
          ...existing,
          requestedName: profile.nickname,
          requestedUsername: profile.username,
          requestedRuntime: profile.runtime,
        }
    requireMatchingIdentityEnrollment(profiledIntent, profile, homeSpace, actorUserId)
    if (!existing.requestedUsername) {
      const bound = await deps.agentIdentities.findActiveByProtocolAgent(input.protocolAgentId)
      if (!bound) throw conflict('The existing Agent enrollment cannot claim a username without its identity.')
      await requireOrClaimIdentityProfile(deps, bound, input)
    }
    return { intent: toIntent(profiledIntent), replayed: true }
  }
  const boundIdentity = await deps.agentIdentities.findActiveByProtocolAgent(input.protocolAgentId)
  if (boundIdentity) {
    const profiledIdentity = await requireOrClaimIdentityProfile(deps, boundIdentity, input)
    const boundHomeSpace = homeSpaceOf(boundIdentity.identity)
    await assertController(deps, boundHomeSpace, actorUserId)
    const approved = await deps.agentIdentities.findLatestApprovedIdentityIntent(input.protocolAgentId)
    if (approved) {
      requireMatchingIdentityEnrollment(
        approved,
        approved.requestedUsername
          ? {
              username: approved.requestedUsername,
              nickname: approved.requestedName!,
              runtime: approved.requestedRuntime!,
            }
          : profile,
        boundHomeSpace,
        actorUserId,
      )
      return { intent: toIntent(approved), replayed: true }
    }
    const now = new Date()
    const migrated = await deps.agentIdentities.createIntentIdempotently({
      id: deps.ids.generate(),
      agentIdentityId: null,
      requestedName: profiledIdentity.identity.name,
      requestedUsername: profiledIdentity.identity.username,
      requestedRuntime: profiledIdentity.identity.runtime,
      ...ownerColumns(boundHomeSpace),
      protocolAgentId: input.protocolAgentId,
      idempotencyKey,
      status: 'approved',
      createdByUserId: actorUserId,
      approvedByUserId: actorUserId,
      expiresAt: new Date(now.getTime() + enrollmentLifetimeMs),
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    requireMatchingIdentityEnrollment(migrated.intent, profile, boundHomeSpace, actorUserId)
    return { intent: toIntent(migrated.intent), replayed: true }
  }
  await assertController(deps, homeSpace, actorUserId)
  await assertProtocolAgentCanEnroll(deps, input.protocolAgentId, actorUserId)
  await requireAvailableAgentUsername(deps, input.username)

  const now = new Date()
  const reserved = await deps.agentIdentities.createIntentIdempotently({
    id: deps.ids.generate(),
    agentIdentityId: null,
    requestedName: profile.nickname,
    requestedUsername: profile.username,
    requestedRuntime: profile.runtime,
    ...ownerColumns(homeSpace),
    protocolAgentId: input.protocolAgentId,
    idempotencyKey,
    status: 'pending',
    createdByUserId: actorUserId,
    approvedByUserId: null,
    expiresAt: new Date(now.getTime() + enrollmentLifetimeMs),
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  requireMatchingIdentityEnrollment(reserved.intent, profile, homeSpace, actorUserId)
  return { intent: toIntent(reserved.intent), replayed: !reserved.created }
}

function requireMatchingIdentityEnrollment(
  intent: AgentEnrollmentIntentRecord,
  profile: { username: string; nickname: string; runtime: string },
  homeSpace: AgentHomeSpace,
  actorUserId: string,
) {
  if (intent.createdByUserId !== actorUserId) throw forbidden('This Agent cannot replay the enrollment request.')
  const sameOwner =
    (homeSpace.type === 'personal' && intent.ownerUserId === homeSpace.userId && intent.ownerOrganizationId === null) ||
    (homeSpace.type === 'organization' &&
      intent.ownerOrganizationId === homeSpace.organizationId &&
      intent.ownerUserId === null)
  if (
    intent.agentIdentityId !== null ||
    intent.requestedName !== profile.nickname ||
    intent.requestedUsername !== profile.username ||
    intent.requestedRuntime !== profile.runtime ||
    !sameOwner
  ) {
    throw conflict('Idempotency-Key was already used for a different Agent identity enrollment.')
  }
}

export async function createAdditionalAgentEnrollmentIntent(
  deps: Deps,
  identityId: string,
  protocolAgentId: string,
  actorUserId: string,
  idempotencyKey: string,
): Promise<{ intent: AgentEnrollmentIntent; replayed: boolean }> {
  const existing = await deps.agentIdentities.findIntentByIdempotencyKey(protocolAgentId, idempotencyKey)
  if (existing) {
    requireMatchingInstallationEnrollment(existing, identityId, actorUserId)
    return { intent: toIntent(existing), replayed: true }
  }
  const aggregate = await requireIdentity(deps, identityId)
  const homeSpace = homeSpaceOf(aggregate.identity)
  await assertController(deps, homeSpace, actorUserId)
  await assertProtocolAgentCanEnroll(deps, protocolAgentId, actorUserId)

  const now = new Date()
  const reserved = await deps.agentIdentities.createIntentIdempotently({
    id: deps.ids.generate(),
    agentIdentityId: identityId,
    requestedName: null,
    requestedUsername: null,
    requestedRuntime: null,
    ...ownerColumns(homeSpace),
    protocolAgentId,
    idempotencyKey,
    status: 'pending',
    createdByUserId: actorUserId,
    approvedByUserId: null,
    expiresAt: new Date(now.getTime() + enrollmentLifetimeMs),
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  requireMatchingInstallationEnrollment(reserved.intent, identityId, actorUserId)
  return { intent: toIntent(reserved.intent), replayed: !reserved.created }
}

function requireMatchingInstallationEnrollment(
  intent: AgentEnrollmentIntentRecord,
  identityId: string,
  actorUserId: string,
) {
  if (intent.createdByUserId !== actorUserId) throw forbidden('This Agent cannot replay the enrollment request.')
  if (intent.agentIdentityId !== identityId) {
    throw conflict('Idempotency-Key was already used for a different Agent installation enrollment.')
  }
}

export async function approveAgentEnrollment(
  deps: Deps,
  intentId: string,
  issuer: string,
  actorUserId: string,
): Promise<{ identity: AgentIdentity }> {
  const intent = await deps.agentIdentities.findIntent(intentId)
  if (!intent) throw notFound('Agent enrollment intent was not found.')
  if (intent.status !== 'pending') throw badRequest('Agent enrollment intent is no longer pending.')
  if (intent.expiresAt.getTime() <= Date.now()) throw badRequest('Agent enrollment intent has expired.')

  const homeSpace = homeSpaceOf(intent)
  await assertController(deps, homeSpace, actorUserId)
  await assertProtocolAgentCanEnroll(deps, intent.protocolAgentId, actorUserId)

  const now = new Date()
  let identity: AgentIdentityRecord | null = null
  let identityId = intent.agentIdentityId
  if (identityId) {
    const existing = await requireIdentity(deps, identityId)
    assertSameHomeSpace(homeSpace, homeSpaceOf(existing.identity))
  } else {
    identityId = deps.ids.generate()
    identity = newAgentIdentityRecord({
      id: identityId,
      subject: deps.ids.generate(),
      issuer,
      username: intent.requestedUsername!,
      name: intent.requestedName!,
      runtime: intent.requestedRuntime!,
      homeSpace,
      now,
    })
  }

  const aggregate = await deps.agentIdentities.approveIntent({
    intentId,
    identity,
    binding: newAgentIdentityBinding({
      id: deps.ids.generate(),
      identityId,
      protocolAgentId: intent.protocolAgentId,
      now,
    }),
    approvedByUserId: actorUserId,
    approvedAt: now,
  })
  await appendIdentityAudit(deps, 'agent.identity_enrolled', aggregate, actorUserId)
  return { identity: toIdentity(aggregate) }
}

export async function revokeAgentIdentityHost(
  deps: Deps,
  identityId: string,
  protocolAgentId: string,
  actorUserId: string,
) {
  const identity = await requireControlledIdentity(deps, identityId, actorUserId)
  if (!(await deps.agentIdentities.revokeBinding(identityId, protocolAgentId, new Date()))) {
    throw notFound('Active Agent host binding was not found.')
  }
  const binding = identity.bindings.find((candidate) => candidate.protocolAgentId === protocolAgentId)
  if (binding) await revokeAgentResourceLeasesForBinding(deps, binding.id)
  await appendIdentityAudit(deps, 'agent.host_revoked', identity, actorUserId, {
    protocolAgentId,
    hostId: binding?.hostId ?? null,
  })
}

export async function recoverAgentIdentity(deps: Deps, identityId: string, actorUserId: string) {
  const identity = await requireControlledIdentity(deps, identityId, actorUserId)
  if (identity.identity.status !== 'active') throw badRequest('Only an active Agent identity can be recovered.')
  if (!(await deps.agentIdentities.deactivateIdentity(identityId, new Date(), true))) {
    throw badRequest('Only an active Agent identity can be recovered.')
  }
  await revokeAgentResourceAccess(deps, identityId)
  await appendIdentityAudit(deps, 'agent.identity_recovered', identity, actorUserId)
}

export async function deactivateAgentIdentity(deps: Deps, identityId: string, actorUserId: string) {
  const identity = await requireControlledIdentity(deps, identityId, actorUserId)
  if (!(await deps.agentIdentities.deactivateIdentity(identityId, new Date(), false))) {
    throw notFound('Agent identity was not found.')
  }
  await appendIdentityAudit(deps, 'agent.identity_deactivated', identity, actorUserId)
}

export async function activateAgentIdentity(deps: Deps, identityId: string, actorUserId: string) {
  const identity = await requireControlledIdentity(deps, identityId, actorUserId)
  if (identity.identity.status === 'active') return
  if (!(await deps.agentIdentities.activateIdentity(identityId, new Date()))) {
    throw badRequest('Agent identity requires a new installation before it can be activated.')
  }
  await appendIdentityAudit(deps, 'agent.identity_activated', identity, actorUserId)
}

export async function deleteAgentIdentity(deps: Deps, identityId: string, actorUserId: string) {
  const identity = await requireControlledIdentity(deps, identityId, actorUserId)
  if (!(await deps.agentIdentities.deleteIdentity(identityId, new Date()))) {
    throw notFound('Agent identity was not found.')
  }
  await revokeAgentResourceAccess(deps, identityId)
  await appendIdentityAudit(deps, 'agent.identity_deleted', identity, actorUserId)
}

export async function requireActiveAgentIdentity(deps: Deps, protocolAgentId: string) {
  const identity = await deps.agentIdentities.findActiveByProtocolAgent(protocolAgentId)
  if (!identity) throw forbidden('Agent protocol identity is not bound to an active Realmroot Agent identity.')
  return identity
}

async function assertProtocolAgentCanEnroll(deps: Deps, protocolAgentId: string, actorUserId: string) {
  const protocolAgent = await deps.agentIdentities.findProtocolAgent(protocolAgentId)
  if (!protocolAgent || protocolAgent.status !== 'active' || protocolAgent.userId !== actorUserId) {
    throw notFound('Active Agent protocol registration was not found.')
  }
  if (await deps.agentIdentities.findBindingByProtocolAgent(protocolAgentId)) {
    throw badRequest('Agent protocol registration is already bound.')
  }
}

async function requireControlledIdentity(deps: Deps, identityId: string, actorUserId: string) {
  const identity = await requireIdentity(deps, identityId)
  await assertController(deps, homeSpaceOf(identity.identity), actorUserId)
  return identity
}

async function requireIdentity(deps: Deps, identityId: string) {
  const identity = await deps.agentIdentities.findIdentity(identityId)
  if (!identity) throw notFound('Agent identity was not found.')
  return identity
}

async function assertController(deps: Deps, homeSpace: AgentHomeSpace, actorUserId: string) {
  if (homeSpace.type === 'personal') {
    if (homeSpace.userId !== actorUserId) throw forbidden('Agent identity controller access is required.')
    return
  }
  if (!(await organizationUserHasScope(deps, homeSpace.organizationId, actorUserId, 'agents:write'))) {
    throw forbidden('Organization Agent controller access is required.')
  }
}

function assertSameHomeSpace(left: AgentHomeSpace, right: AgentHomeSpace) {
  if (
    left.type !== right.type ||
    (left.type === 'personal' && right.type === 'personal' && left.userId !== right.userId) ||
    (left.type === 'organization' && right.type === 'organization' && left.organizationId !== right.organizationId)
  ) {
    throw forbidden('Enrollment intent does not belong to the Agent identity home space.')
  }
}

function ownerColumns(homeSpace: AgentHomeSpace) {
  return homeSpace.type === 'personal'
    ? { ownerUserId: homeSpace.userId, ownerOrganizationId: null }
    : { ownerUserId: null, ownerOrganizationId: homeSpace.organizationId }
}

function newAgentIdentityRecord(input: {
  id: string
  subject: string
  issuer: string
  username: string
  name: string
  runtime: string
  homeSpace: AgentHomeSpace
  now: Date
}): AgentIdentityRecord {
  return {
    id: input.id,
    issuer: input.issuer,
    subject: input.subject,
    username: input.username,
    name: input.name,
    runtime: input.runtime,
    ...ownerColumns(input.homeSpace),
    status: 'active',
    deletedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

function newAgentIdentityBinding(input: {
  id: string
  identityId: string
  protocolAgentId: string
  now: Date
}): Omit<AgentIdentityBindingRecord, 'hostId'> {
  return {
    id: input.id,
    agentIdentityId: input.identityId,
    protocolAgentId: input.protocolAgentId,
    status: 'active',
    boundAt: input.now,
    revokedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

function managedAgentIds(deps: Deps) {
  return {
    identityId: deps.ids.generate(),
    subject: deps.ids.generate(),
    bindingId: deps.ids.generate(),
    auditId: deps.ids.generate(),
    reservationId: deps.ids.generate(),
  }
}

async function replayLegacyApplicationAgent(
  deps: Deps,
  input: CreateAgent,
  context: { applicationId: string; actorUserId: string; issuer: string; idempotencyKey: string },
  requestFingerprint: string,
): Promise<{ agent: Agent; replayed: true } | null> {
  const ids = await legacyApplicationAgentLookupIds(context)
  const identity = await deps.agentIdentities.findIdentity(ids.identityId)
  if (!identity) return null
  const [protocolAgent, hosts, audit] = await Promise.all([
    deps.agentIdentities.findProtocolAgent(input.installation.agentId),
    deps.agents.listHostsForAgents([input.installation.hostId]),
    deps.agentAudit.findById(ids.auditId),
  ])
  requireMatchingLegacyApplicationAgent(identity, protocolAgent, hosts[0] ?? null, audit, input, ids, context)
  const reservation = await deps.agentIdentities.reserveApplicationCreation({
    id: deps.ids.generate(),
    applicationId: context.applicationId,
    actorUserId: context.actorUserId,
    idempotencyKey: context.idempotencyKey,
    requestFingerprint,
    agentIdentityId: identity.identity.id,
    createdAt: new Date(),
  })
  requireMatchingApplicationAgentCreation(reservation.reservation.requestFingerprint, requestFingerprint)
  requireLiveApplicationAgent(reservation.identity)
  return { agent: toAgent(reservation.identity), replayed: true }
}

async function recoverLegacyApplicationAgentAfterFailure(
  deps: Deps,
  input: CreateAgent,
  context: { applicationId: string; actorUserId: string; issuer: string; idempotencyKey: string },
  requestFingerprint: string,
  originalError: unknown,
) {
  try {
    return await replayLegacyApplicationAgent(deps, input, context, requestFingerprint)
  } catch (recoveryError) {
    if (recoveryError instanceof ApiError) throw recoveryError
    throw originalError
  }
}

type LegacyApplicationAgentLookupIds = Awaited<ReturnType<typeof legacyApplicationAgentLookupIds>>

async function legacyApplicationAgentLookupIds(context: {
  applicationId: string
  actorUserId: string
  idempotencyKey: string
}) {
  const bytes = new TextEncoder().encode(
    `${context.applicationId}\u0000${context.actorUserId}\u0000${context.idempotencyKey}`,
  )
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return {
    identityId: `agi_${hash}`,
    subject: `agt_${hash}`,
    bindingId: `agb_${hash}`,
    auditId: `aga_${hash}`,
  }
}

function requireMatchingLegacyApplicationAgent(
  aggregate: AgentIdentityAggregate,
  protocolAgent: AgentRecord | null,
  host: AgentHostRecord | null,
  audit: AgentAuditEventRecord | null,
  input: CreateAgent,
  ids: LegacyApplicationAgentLookupIds,
  context: { applicationId: string; actorUserId: string; issuer: string },
) {
  const publicKey = canonicalJson(input.installation.publicKey)
  const binding = aggregate.bindings.find((candidate) => candidate.id === ids.bindingId)
  const actual = {
    identity: {
      id: aggregate.identity.id,
      issuer: aggregate.identity.issuer,
      subject: aggregate.identity.subject,
      username: aggregate.identity.username,
      name: aggregate.identity.name,
      runtime: aggregate.identity.runtime,
      ownerUserId: aggregate.identity.ownerUserId,
      ownerOrganizationId: aggregate.identity.ownerOrganizationId,
      status: aggregate.identity.status,
      deletedAt: aggregate.identity.deletedAt,
    },
    binding: binding && {
      id: binding.id,
      agentIdentityId: binding.agentIdentityId,
      protocolAgentId: binding.protocolAgentId,
      hostId: binding.hostId,
      status: binding.status,
      revokedAt: binding.revokedAt,
    },
    protocolAgent: protocolAgent && {
      id: protocolAgent.id,
      name: protocolAgent.name,
      userId: protocolAgent.userId,
      hostId: protocolAgent.hostId,
      status: protocolAgent.status,
      mode: protocolAgent.mode,
      kid: protocolAgent.kid,
      publicKey: protocolAgent.publicKey,
    },
    host: host && {
      id: host.id,
      name: host.name,
      userId: host.userId,
      status: host.status,
      kid: host.kid,
      publicKey: host.publicKey,
    },
    audit: audit && {
      id: audit.id,
      action: audit.action,
      result: audit.result,
      realmOwned: audit.realmOwned,
      ownerUserId: audit.ownerUserId,
      ownerOrganizationId: audit.ownerOrganizationId,
      controllerUserId: audit.controllerUserId,
      subjectIssuer: audit.subjectIssuer,
      subject: audit.subject,
      agentIdentityId: audit.agentIdentityId,
      hostId: audit.hostId,
      metadata: audit.metadata,
    },
  }
  const expected = {
    identity: {
      id: ids.identityId,
      issuer: context.issuer,
      subject: ids.subject,
      username: input.username,
      name: input.name,
      runtime: input.runtime,
      ownerUserId: context.actorUserId,
      ownerOrganizationId: null,
      status: 'active',
      deletedAt: null,
    },
    binding: {
      id: ids.bindingId,
      agentIdentityId: ids.identityId,
      protocolAgentId: input.installation.agentId,
      hostId: input.installation.hostId,
      status: 'active',
      revokedAt: null,
    },
    protocolAgent: {
      id: input.installation.agentId,
      name: input.name,
      userId: context.actorUserId,
      hostId: input.installation.hostId,
      status: 'active',
      mode: 'delegated',
      kid: input.installation.kid,
      publicKey,
    },
    host: {
      id: input.installation.hostId,
      name: input.installation.name,
      userId: context.actorUserId,
      status: 'active',
      kid: input.installation.kid,
      publicKey,
    },
    audit: {
      id: ids.auditId,
      action: 'agent.identity_enrolled',
      result: 'allowed',
      realmOwned: false,
      ownerUserId: context.actorUserId,
      ownerOrganizationId: null,
      controllerUserId: context.actorUserId,
      subjectIssuer: context.issuer,
      subject: ids.subject,
      agentIdentityId: ids.identityId,
      hostId: input.installation.hostId,
      metadata: { source: 'application', applicationId: context.applicationId },
    },
  }
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw conflict('Idempotency-Key was already used for a different Agent.')
  }
}

async function applicationAgentCreationFingerprint(
  input: CreateAgent,
  context: { applicationId: string; actorUserId: string; issuer: string },
) {
  const representation = canonicalJson({
    applicationId: context.applicationId,
    actorUserId: context.actorUserId,
    issuer: context.issuer,
    agent: input,
  })
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(representation))
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function requireMatchingApplicationAgentCreation(actualFingerprint: string, requestFingerprint: string) {
  if (actualFingerprint !== requestFingerprint) {
    throw conflict('Idempotency-Key was already used for a different Agent.')
  }
}

function requireLiveApplicationAgent(identity: AgentIdentityAggregate) {
  if (identity.identity.deletedAt) {
    throw conflict('The Agent identity remains reserved after deletion and cannot be recreated.')
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

async function appendIdentityAudit(
  deps: Deps,
  action: string,
  aggregate: AgentIdentityAggregate,
  controllerUserId: string | null,
  metadata?: Record<string, unknown>,
) {
  const binding = aggregate.bindings.at(-1)
  await appendAgentGovernanceAudit(deps, {
    action,
    result: 'allowed',
    tenant:
      aggregate.identity.ownerUserId !== null
        ? { type: 'user', id: aggregate.identity.ownerUserId }
        : { type: 'organization', id: aggregate.identity.ownerOrganizationId! },
    controllerUserId,
    issuer: aggregate.identity.issuer,
    subject: aggregate.identity.subject,
    agentIdentityId: aggregate.identity.id,
    hostId: binding?.hostId ?? null,
    metadata: metadata ?? null,
  })
}

async function loadManagementSummaries(deps: Deps, agents: AgentIdentityAggregate[]) {
  const identities = agents.map((aggregate) => aggregate.identity)
  const [access, owners] = await Promise.all([
    deps.externalResources.summarizeAgentAccess(
      identities.map((identity) => identity.id),
      new Date(),
    ),
    loadManagementOwners(deps, identities),
  ])
  return { access, owners }
}

async function loadManagementOwners(deps: Deps, identities: AgentIdentityRecord[]) {
  const homeSpaces = [
    ...new Map(identities.map((identity) => [ownerKey(homeSpaceOf(identity)), homeSpaceOf(identity)])).values(),
  ]
  const owners = await Promise.all(
    homeSpaces.map(async (homeSpace) => {
      const key = ownerKey(homeSpace)
      if (homeSpace.type === 'personal') {
        const user = await deps.users.getUser(homeSpace.userId)
        return [key, { id: user.id, type: 'user' as const, displayName: user.displayName || user.email }] as const
      }
      const organization = await deps.authorization.findOrganization(homeSpace.organizationId)
      if (!organization) {
        throw new Error(`Agent owner Organization ${homeSpace.organizationId} was not found.`)
      }
      return [
        key,
        {
          id: organization.id,
          type: 'organization' as const,
          displayName: organization.displayName ?? organization.name,
        },
      ] as const
    }),
  )
  return new Map<string, { id: string; type: 'user' | 'organization'; displayName: string }>(owners)
}

function ownerKey(homeSpace: AgentHomeSpace) {
  return homeSpace.type === 'personal' ? `user:${homeSpace.userId}` : `organization:${homeSpace.organizationId}`
}

function toManagementAgent(
  aggregate: AgentIdentityAggregate,
  summaries: Awaited<ReturnType<typeof loadManagementSummaries>>,
) {
  const access = summaries.access.get(aggregate.identity.id)
  if (!access) throw new Error(`Agent access summary was not resolved for ${aggregate.identity.id}.`)
  const owner = summaries.owners.get(ownerKey(homeSpaceOf(aggregate.identity)))
  if (!owner) throw new Error(`Agent owner was not resolved for ${aggregate.identity.id}.`)
  return {
    ...toAgent(aggregate),
    owner,
    installationCount: aggregate.bindings.filter((binding) => binding.status === 'active').length,
    pendingRequestCount: access.pendingRequestCount,
    activeResourceCount: access.activeResourceCount,
    activeScopeCount: access.activeScopeCount,
  }
}

function homeSpaceOf(
  value:
    | Pick<AgentIdentityRecord, 'ownerUserId' | 'ownerOrganizationId'>
    | Pick<AgentEnrollmentIntentRecord, 'ownerUserId' | 'ownerOrganizationId'>,
): AgentHomeSpace {
  if (value.ownerUserId) return { type: 'personal', userId: value.ownerUserId }
  if (value.ownerOrganizationId) return { type: 'organization', organizationId: value.ownerOrganizationId }
  throw new Error('Agent identity owner invariant was violated.')
}

function toIntent(record: AgentEnrollmentIntentRecord): AgentEnrollmentIntent {
  return {
    id: record.id,
    agentIdentityId: record.agentIdentityId,
    requestedNickname: record.requestedName,
    requestedUsername: record.requestedUsername ?? null,
    requestedRuntime: record.requestedRuntime ?? null,
    homeSpace: homeSpaceOf(record),
    protocolAgentId: record.protocolAgentId,
    status: record.status as AgentEnrollmentIntent['status'],
    expiresAt: record.expiresAt,
    approvedAt: record.approvedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function toIdentity(aggregate: AgentIdentityAggregate): AgentIdentity {
  const record = aggregate.identity
  return {
    id: record.id,
    issuer: record.issuer,
    subject: record.subject,
    username: record.username,
    name: record.name,
    runtime: record.runtime ?? null,
    homeSpace: homeSpaceOf(record),
    status: record.status as AgentIdentity['status'],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    bindings: aggregate.bindings.map((binding) => ({
      id: binding.id,
      protocolAgentId: binding.protocolAgentId,
      hostId: binding.hostId,
      status: binding.status as AgentIdentity['bindings'][number]['status'],
      boundAt: binding.boundAt,
      revokedAt: binding.revokedAt,
    })),
  }
}

export function toAgent(identity: AgentIdentityAggregate | AgentIdentity): Agent {
  const value = 'identity' in identity ? toIdentity(identity) : identity
  return {
    id: value.id,
    issuer: value.issuer,
    subject: value.subject,
    username: value.username,
    name: value.name,
    runtime: value.runtime ?? null,
    homeSpace: value.homeSpace,
    status: value.status,
    createdAt: iso(value.createdAt)!,
    updatedAt: iso(value.updatedAt)!,
  }
}

export function toAgentEnrollment(
  intent: AgentEnrollmentIntent,
  profile: { username: string | null; nickname: string; runtime: string | null },
): AgentEnrollment {
  return {
    id: intent.id,
    agentId: intent.agentIdentityId,
    ...profile,
    kind: intent.agentIdentityId ? 'additional_host' : 'new_identity',
    homeSpace: intent.homeSpace,
    status: intent.status === 'approved' ? 'approved' : intent.status,
    expiresAt: iso(intent.expiresAt)!,
    decidedAt: iso(intent.approvedAt),
    createdAt: iso(intent.createdAt)!,
    updatedAt: iso(intent.updatedAt)!,
  }
}

async function enrollmentAgentProfile(deps: Deps, intent: AgentEnrollmentIntent) {
  if (intent.requestedNickname) {
    return {
      username: intent.requestedUsername,
      nickname: intent.requestedNickname,
      runtime: intent.requestedRuntime,
    }
  }
  if (!intent.agentIdentityId) throw new Error(`Agent enrollment ${intent.id} has no requested or existing identity.`)
  const identity = (await requireIdentity(deps, intent.agentIdentityId)).identity
  return { username: identity.username, nickname: identity.name, runtime: identity.runtime ?? null }
}

async function requireAvailableAgentUsername(deps: Deps, username: string) {
  if (await deps.agentIdentities.findByUsername(username))
    throw conflict(`Agent username "${username}" is unavailable.`)
}

async function requireOrClaimIdentityProfile(
  deps: Deps,
  aggregate: AgentIdentityAggregate,
  input: { username: string; nickname?: string; runtime: string },
) {
  if (aggregate.identity.username) {
    if (aggregate.identity.username !== input.username) throw conflict('Agent username is immutable.')
    return aggregate
  }
  await requireAvailableAgentUsername(deps, input.username)
  const claimed = await deps.agentIdentities.claimIdentityProfile(aggregate.identity.id, {
    username: input.username,
    name: input.nickname ?? input.runtime,
    runtime: input.runtime,
    updatedAt: new Date(),
  })
  if (!claimed) throw conflict('Agent username has already been assigned.')
  return claimed
}

function iso(value: string | Date | null) {
  if (value === null) return null
  return typeof value === 'string' ? value : value.toISOString()
}
