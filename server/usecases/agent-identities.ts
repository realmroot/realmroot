import { badRequest, forbidden, notFound } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import type { AgentEnrollmentIntentRecord, AgentIdentityAggregate, AgentIdentityRecord } from '@server/usecases/ports'
import type {
  AgentEnrollmentIntent,
  AgentHomeSpace,
  AgentIdentity,
  CreateAgentEnrollmentIntentRequest,
} from '@shared/api/agents'

const enrollmentLifetimeMs = 10 * 60 * 1000

export async function listPersonalAgentIdentities(
  deps: Deps,
  userId: string,
): Promise<{ identities: AgentIdentity[] }> {
  return { identities: (await deps.agentIdentities.listPersonal(userId)).map(toIdentity) }
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
  return toIdentity(
    await deps.agentIdentities.createIdentity({
      identity: {
        id: identityId,
        issuer,
        subject: createId('agt'),
        name: input.name,
        ownerUserId: controllerUserId,
        ownerOrganizationId: null,
        status: 'active',
        retiredAt: null,
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
    }),
  )
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

export async function emergencyRetireAgentIdentity(deps: Deps, identityId: string) {
  if (!(await deps.agentIdentities.retireIdentity(identityId, new Date()))) {
    throw badRequest('Agent identity is already retired.')
  }
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
): Promise<AgentEnrollmentIntent> {
  const aggregate = await requireIdentity(deps, identityId)
  if (aggregate.identity.status === 'retired') throw badRequest('Retired Agent identities cannot enroll hosts.')
  const homeSpace = homeSpaceOf(aggregate.identity)
  await assertController(deps, homeSpace, actorUserId)
  await assertProtocolAgentCanEnroll(deps, protocolAgentId, actorUserId)

  const now = new Date()
  return toIntent(
    await deps.agentIdentities.createIntent({
      id: createId('agenr'),
      agentIdentityId: identityId,
      requestedName: null,
      ...ownerColumns(homeSpace),
      protocolAgentId,
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
    if (existing.identity.status === 'retired') throw badRequest('Retired Agent identities cannot enroll hosts.')
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
      retiredAt: null,
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
  return { identity: toIdentity(aggregate) }
}

export async function revokeAgentIdentityHost(
  deps: Deps,
  identityId: string,
  protocolAgentId: string,
  actorUserId: string,
) {
  const identity = await requireControlledIdentity(deps, identityId, actorUserId)
  if (identity.identity.status === 'retired') throw badRequest('Agent identity is retired.')
  if (!(await deps.agentIdentities.revokeBinding(identityId, protocolAgentId, new Date()))) {
    throw notFound('Active Agent host binding was not found.')
  }
}

export async function recoverAgentIdentity(deps: Deps, identityId: string, actorUserId: string) {
  await requireControlledIdentity(deps, identityId, actorUserId)
  if (!(await deps.agentIdentities.recoverIdentity(identityId, new Date()))) {
    throw badRequest('Only an active Agent identity can be recovered.')
  }
}

export async function retireAgentIdentity(deps: Deps, identityId: string, actorUserId: string) {
  await requireControlledIdentity(deps, identityId, actorUserId)
  if (!(await deps.agentIdentities.retireIdentity(identityId, new Date()))) {
    throw badRequest('Agent identity is already retired.')
  }
}

export async function requireActiveAgentIdentity(deps: Deps, protocolAgentId: string) {
  const identity = await deps.agentIdentities.findActiveByProtocolAgent(protocolAgentId)
  if (!identity) throw forbidden('Agent protocol identity is not bound to an active FlareAuth Agent identity.')
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
  const member = await deps.authorization.findMemberByOrganizationUser(homeSpace.organizationId, actorUserId)
  if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
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
    retiredAt: record.retiredAt,
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

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}
