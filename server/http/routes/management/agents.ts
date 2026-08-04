import { forbidden } from '@server/domain/errors'
import {
  emergencyRetireAgentIdentity,
  getAgent,
  getManagementAgent,
  getManagementAgentAccessGrant,
  getManagementAgentAccessRequest,
  listAllAgents,
  listManagementAgentAccessGrants,
  listManagementAgentAccessRequests,
  listManagementAgentInstallations,
  recoverAgentIdentity,
} from '@server/usecases/agent-identities'
import {
  decideAccessRequest,
  getAccessRequest,
  getAgentAccessGrant,
  listAgentAccessGrants,
  revokeAgentAccessGrant,
} from '@server/usecases/external-resources'
import {
  accessGrantSchema,
  accessGrantsResponseSchema,
  accessRequestSchema,
  decideAccessRequestSchema,
  listAgentAuditEventsQuerySchema,
  listAgentsQuerySchema,
  listManagementAgentAccessGrantsQuerySchema,
  listManagementAgentAccessRequestsQuerySchema,
  managementAgentAccessGrantSchema,
  managementAgentAccessGrantsResponseSchema,
  managementAgentAccessRequestSchema,
  managementAgentAccessRequestsResponseSchema,
  managementAgentInstallationsResponseSchema,
  managementAgentResponseSchema,
  managementAgentsResponseSchema,
} from '@shared/api/agent-api'
import { agentAuditEventSchema } from '@shared/api/agents'
import { paginationMetadata, paginationQuerySchema } from '@shared/api/pagination'
import { Hono } from 'hono'
import { getActorUserId, getPrincipal } from '../../middleware/authn'
import {
  getManagementAccessScope,
  requireConsoleOrganizationAccess,
  requireRealmConsoleAccess,
  resolveOrganizationInventoryScope,
} from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementAgentsRoute = new Hono()

managementAgentsRoute.get('/agents', async (c) => {
  const query = readQuery(c, listAgentsQuerySchema)
  return c.json(
    managementAgentsResponseSchema.parse(
      await listAllAgents(getDeps(c), query, resolveOrganizationInventoryScope(c, query.organizationId)),
    ),
  )
})

managementAgentsRoute.get('/agents/:agentId', async (c) => {
  const result = await getManagementAgent(getDeps(c), c.req.param('agentId'))
  requireAgentConsoleAccess(c, result.agent)
  return c.json(managementAgentResponseSchema.parse(result))
})

managementAgentsRoute.get('/agents/:agentId/installations', async (c) => {
  await requireAgentByIdConsoleAccess(c, c.req.param('agentId'))
  return c.json(
    managementAgentInstallationsResponseSchema.parse(
      await listManagementAgentInstallations(getDeps(c), c.req.param('agentId'), readQuery(c, paginationQuerySchema)),
    ),
  )
})

managementAgentsRoute.get('/access/requests', async (c) => {
  const query = readQuery(c, listManagementAgentAccessRequestsQuerySchema)
  const principal = getPrincipal(c).agent
  return c.json(
    managementAgentAccessRequestsResponseSchema.parse(
      await listManagementAgentAccessRequests(
        getDeps(c),
        principal ? { ...query, agentId: principal.identityId } : query,
        principal ? undefined : authorityInventoryScope(c, query.organizationId),
      ),
    ),
  )
})

managementAgentsRoute.get('/access/requests/:requestId', async (c) => {
  const principal = getPrincipal(c).agent
  if (principal) {
    return c.json(
      accessRequestSchema.parse(
        await getAccessRequest(getDeps(c), c.req.param('requestId'), principal, new URL(c.req.url).origin),
      ),
    )
  }
  const request = await getManagementAgentAccessRequest(getDeps(c), c.req.param('requestId'))
  await requireAgentByIdAccess(c, request.agentId)
  return c.json(managementAgentAccessRequestSchema.parse(request))
})

managementAgentsRoute.get('/access/requests/:requestId/decision', async (c) => {
  const request = await getManagementAgentAccessRequest(getDeps(c), c.req.param('requestId'))
  await requireAgentByIdAccess(c, request.agentId)
  return c.json({ accessRequestId: request.id, status: request.status, decidedAt: request.decidedAt })
})

managementAgentsRoute.put('/access/requests/:requestId/decision', async (c) => {
  const request = await getManagementAgentAccessRequest(getDeps(c), c.req.param('requestId'))
  await requireAgentByIdAccess(c, request.agentId)
  const decided = await decideAccessRequest(
    getDeps(c),
    request.id,
    await readJson(c, decideAccessRequestSchema),
    getActorUserId(c)!,
  )
  return c.json({ accessRequestId: decided.id, status: decided.status, decidedAt: decided.decidedAt })
})

managementAgentsRoute.get('/access/authorizations', async (c) => {
  const principal = getPrincipal(c).agent
  if (principal) {
    return c.json(
      accessGrantsResponseSchema.parse(
        await listAgentAccessGrants(getDeps(c), principal, readQuery(c, paginationQuerySchema)),
      ),
    )
  }
  const query = readQuery(c, listManagementAgentAccessGrantsQuerySchema)
  return c.json(
    managementAgentAccessGrantsResponseSchema.parse(
      await listManagementAgentAccessGrants(getDeps(c), query, authorityInventoryScope(c, query.organizationId)),
    ),
  )
})

managementAgentsRoute.get('/access/authorizations/:authorizationId', async (c) => {
  const principal = getPrincipal(c).agent
  if (principal) {
    return c.json(
      accessGrantSchema.parse(await getAgentAccessGrant(getDeps(c), c.req.param('authorizationId'), principal)),
    )
  }
  const grant = await getManagementAgentAccessGrant(getDeps(c), c.req.param('authorizationId'))
  await requireAgentByIdAccess(c, grant.agentId)
  return c.json(managementAgentAccessGrantSchema.parse(grant))
})

managementAgentsRoute.get('/access/authorizations/:authorizationId/revocation', async (c) => {
  const grant = await getManagementAgentAccessGrant(getDeps(c), c.req.param('authorizationId'))
  await requireAgentByIdAccess(c, grant.agentId)
  return c.json({ authorizationId: grant.id, status: grant.status })
})

managementAgentsRoute.put('/access/authorizations/:authorizationId/revocation', async (c) => {
  const grant = await getManagementAgentAccessGrant(getDeps(c), c.req.param('authorizationId'))
  await requireAgentByIdAccess(c, grant.agentId)
  await revokeAgentAccessGrant(getDeps(c), grant.id, getActorUserId(c)!)
  return c.json({ authorizationId: grant.id, status: 'revoked' as const })
})

managementAgentsRoute.get('/agents/:agentId/retirement', async (c) => {
  const result = await getManagementAgent(getDeps(c), c.req.param('agentId'))
  requireAgentConsoleAccess(c, result.agent)
  return c.json({ agentId: result.agent.id, status: result.agent.status, retiredAt: result.agent.retiredAt })
})

managementAgentsRoute.put('/agents/:agentId/retirement', async (c) => {
  await emergencyRetireAgentIdentity(getDeps(c), c.req.param('agentId'), getActorUserId(c))
  return c.body(null, 204)
})

managementAgentsRoute.delete('/agents/:agentId/retirement', async (c) => {
  await recoverAgentIdentity(getDeps(c), c.req.param('agentId'), getActorUserId(c)!)
  return c.body(null, 204)
})

managementAgentsRoute.get('/realm/audit-events', async (c) => {
  const query = readQuery(c, listAgentAuditEventsQuerySchema)
  const organizationIds = resolveOrganizationInventoryScope(c, query.organizationId)
  if (query.agentId) {
    const agent = await getAgent(getDeps(c), query.agentId)
    if (agent.homeSpace.type === 'organization') {
      requireConsoleOrganizationAccess(c, agent.homeSpace.organizationId)
    } else {
      requireRealmConsoleAccess(c)
    }
  }
  const result = await getDeps(c).agentAudit.list(query, {
    agentIdentityId: query.agentId,
    ownerOrganizationIds: organizationIds,
  })
  return c.json({
    items: result.items.map((event) => agentAuditEventSchema.parse(event)),
    pagination: paginationMetadata({ ...query, total: result.total }),
  })
})

async function requireAgentByIdConsoleAccess(c: Parameters<typeof getDeps>[0], agentId: string) {
  const agent = await getAgent(getDeps(c), agentId)
  requireAgentConsoleAccess(c, agent)
}

async function requireAgentByIdAccess(c: Parameters<typeof getDeps>[0], agentId: string) {
  const agent = await getAgent(getDeps(c), agentId)
  const access = getManagementAccessScope(c)
  if (access?.kind === 'account') {
    if (
      (agent.homeSpace.type === 'personal' && agent.homeSpace.userId !== access.userId) ||
      (agent.homeSpace.type === 'organization' && !access.organizationIds.includes(agent.homeSpace.organizationId))
    ) {
      throw forbidden()
    }
    return
  }
  requireAgentConsoleAccess(c, agent)
}

function authorityInventoryScope(c: Parameters<typeof getDeps>[0], requestedOrganizationId?: string) {
  const access = getManagementAccessScope(c)
  if (!access || access.kind === 'realm') {
    return requestedOrganizationId ? { ownerOrganizationIds: [requestedOrganizationId] } : undefined
  }
  const organizationIds = requestedOrganizationId
    ? access.organizationIds.includes(requestedOrganizationId)
      ? [requestedOrganizationId]
      : []
    : access.organizationIds
  return {
    ownerOrganizationIds: organizationIds,
    ...(access.kind === 'account' ? { ownerUserId: access.userId } : {}),
  }
}

function requireAgentConsoleAccess(c: Parameters<typeof getDeps>[0], agent: Awaited<ReturnType<typeof getAgent>>) {
  if (agent.homeSpace.type === 'organization') {
    requireConsoleOrganizationAccess(c, agent.homeSpace.organizationId)
    return
  }
  requireRealmConsoleAccess(c)
}
