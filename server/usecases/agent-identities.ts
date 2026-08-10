import { badRequest, conflict, forbidden, notFound } from '@server/domain/errors'
import { appendAgentGovernanceAudit } from '@server/usecases/agent-audit'
import type { Deps } from '@server/usecases/deps'
import { revokeAgentResourceAccess, revokeAgentResourceLeasesForBinding } from '@server/usecases/external-resources'
import { organizationUserHasScope } from '@server/usecases/organization-membership-scopes'
import type {
  AgentAuthorityInventoryScope,
  AgentEnrollmentIntentRecord,
  AgentIdentityAggregate,
  AgentIdentityRecord,
} from '@server/usecases/ports'
import { resourceScopeEntitlementLifecycle } from '@server/usecases/resource-scope-entitlements'
import type { Agent, AgentEnrollment, ListAgentPermissionsQuery } from '@shared/api/agent-api'
import type {
  AgentEnrollmentIntent,
  AgentHomeSpace,
  AgentIdentity,
  CreateAgentEnrollmentIntentRequest,
} from '@shared/api/agents'
import type { ListAuthorizedResourceServersQuery } from '@shared/api/authorization'
import { type PaginationInput, paginationMetadata } from '@shared/api/pagination'

const enrollmentLifetimeMs = 10 * 60 * 1000

export async function listPersonalAgentIdentities(
  deps: Deps,
  userId: string,
): Promise<{ identities: AgentIdentity[] }> {
  return { identities: (await deps.agentIdentities.listPersonal(userId)).map(toIdentity) }
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
): Promise<{ identities: AgentIdentity[] }> {
  await assertController(deps, { type: 'organization', organizationId }, actorUserId)
  return { identities: (await deps.agentIdentities.listOrganization(organizationId)).map(toIdentity) }
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
  const result = await deps.externalResources.listAgentPermissions(query, scope)
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
    limit: 100,
    offset: 0,
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
  return deps.authorization.listAuthorizedResourceServers({ type: 'agent', id: agentId }, query, new Date())
}

export async function getAgentIdentityByProtocolAgent(deps: Deps, protocolAgentId: string): Promise<AgentIdentity> {
  const identity = await deps.agentIdentities.findActiveByProtocolAgent(protocolAgentId)
  if (!identity) throw notFound('The Agent does not have an active stable identity.')
  return toIdentity(identity)
}

export async function createAgentLoginIdentity(
  deps: Deps,
  input: { protocolAgentId: string; name: string },
  issuer: string,
  controllerUserId: string,
): Promise<AgentIdentity> {
  const existing = await deps.agentIdentities.findActiveByProtocolAgent(input.protocolAgentId)
  if (existing) return toIdentity(existing)

  await assertProtocolAgentCanEnroll(deps, input.protocolAgentId, controllerUserId)

  const now = new Date()
  const identityId = createId('agid')
  const aggregate = await deps.agentIdentities.createIdentity({
    identity: {
      id: identityId,
      issuer,
      subject: createId('agt'),
      name: input.name,
      ownerUserId: controllerUserId,
      ownerOrganizationId: null,
      status: 'active',
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    binding: {
      id: createId('agbind'),
      agentIdentityId: identityId,
      protocolAgentId: input.protocolAgentId,
      status: 'active',
      boundAt: now,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    },
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
  return toAgentEnrollment(intent, await enrollmentAgentName(deps, intent))
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
  return toAgentEnrollment(enrollmentIntent, await enrollmentAgentName(deps, enrollmentIntent))
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
): Promise<AgentEnrollmentIntent> {
  const homeSpace = input.organizationId
    ? ({ type: 'organization', organizationId: input.organizationId } as const)
    : ({ type: 'personal', userId: actorUserId } as const)
  await assertController(deps, homeSpace, actorUserId)
  await assertProtocolAgentCanEnroll(deps, input.protocolAgentId, actorUserId)

  const now = new Date()
  return toIntent(
    await deps.agentIdentities.createIntent({
      id: createId('agenr'),
      agentIdentityId: null,
      requestedName: input.name,
      ...ownerColumns(homeSpace),
      protocolAgentId: input.protocolAgentId,
      idempotencyKey: null,
      status: 'pending',
      createdByUserId: actorUserId,
      approvedByUserId: null,
      expiresAt: new Date(now.getTime() + enrollmentLifetimeMs),
      approvedAt: null,
      createdAt: now,
      updatedAt: now,
    }),
  )
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
    id: createId('agenr'),
    agentIdentityId: identityId,
    requestedName: null,
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
    identityId = createId('agid')
    identity = {
      id: identityId,
      issuer,
      subject: createId('agt'),
      name: intent.requestedName!,
      ...ownerColumns(homeSpace),
      status: 'active',
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    }
  }

  const aggregate = await deps.agentIdentities.approveIntent({
    intentId,
    identity,
    binding: {
      id: createId('agbind'),
      agentIdentityId: identityId,
      protocolAgentId: intent.protocolAgentId,
      status: 'active',
      boundAt: now,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    },
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
    requestedName: record.requestedName,
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
    name: record.name,
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
    name: value.name,
    homeSpace: value.homeSpace,
    status: value.status,
    createdAt: iso(value.createdAt)!,
    updatedAt: iso(value.updatedAt)!,
  }
}

export function toAgentEnrollment(intent: AgentEnrollmentIntent, name = intent.requestedName): AgentEnrollment {
  if (!name) throw new Error(`Agent enrollment ${intent.id} does not resolve to an Agent name.`)
  return {
    id: intent.id,
    agentId: intent.agentIdentityId,
    name,
    kind: intent.agentIdentityId ? 'additional_host' : 'new_identity',
    homeSpace: intent.homeSpace,
    status: intent.status === 'approved' ? 'approved' : intent.status,
    expiresAt: iso(intent.expiresAt)!,
    decidedAt: iso(intent.approvedAt),
    createdAt: iso(intent.createdAt)!,
    updatedAt: iso(intent.updatedAt)!,
  }
}

async function enrollmentAgentName(deps: Deps, intent: AgentEnrollmentIntent) {
  if (intent.requestedName) return intent.requestedName
  if (!intent.agentIdentityId) throw new Error(`Agent enrollment ${intent.id} has no requested or existing identity.`)
  return (await requireIdentity(deps, intent.agentIdentityId)).identity.name
}

function iso(value: string | Date | null) {
  if (value === null) return null
  return typeof value === 'string' ? value : value.toISOString()
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}
