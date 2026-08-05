import {
  ownerFromAgentHomeSpace,
  requireManagementOwner,
  resolveManagementOwnerFilter,
} from '@server/domain/management-authorization'
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
import { decideAccessRequest, revokeAgentAccessGrant } from '@server/usecases/external-resources'
import {
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
import { getManagementActor, getManagementBoundary, requireHumanManagementActor } from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementAgentsRoute = new Hono()

managementAgentsRoute.get('/agents', async (c) => {
  const query = readQuery(c, listAgentsQuerySchema)
  return c.json(
    managementAgentsResponseSchema.parse(
      await listAllAgents(getDeps(c), query, agentInventoryScope(c, query.organizationId)),
    ),
  )
})

managementAgentsRoute.get('/agents/:agentId', async (c) => {
  const result = await getManagementAgent(getDeps(c), c.req.param('agentId'))
  requireAgentManagementAccess(c, result.agent)
  return c.json(managementAgentResponseSchema.parse(result))
})

managementAgentsRoute.get('/agents/:agentId/installations', async (c) => {
  await requireAgentByIdManagementAccess(c, c.req.param('agentId'))
  return c.json(
    managementAgentInstallationsResponseSchema.parse(
      await listManagementAgentInstallations(getDeps(c), c.req.param('agentId'), readQuery(c, paginationQuerySchema)),
    ),
  )
})

managementAgentsRoute.get('/access/requests', async (c) => {
  const query = readQuery(c, listManagementAgentAccessRequestsQuerySchema)
  return c.json(
    managementAgentAccessRequestsResponseSchema.parse(
      await listManagementAgentAccessRequests(getDeps(c), query, agentInventoryScope(c, query.organizationId)),
    ),
  )
})

managementAgentsRoute.get('/access/requests/:requestId', async (c) => {
  const request = await getManagementAgentAccessRequest(getDeps(c), c.req.param('requestId'))
  await requireAgentByIdManagementAccess(c, request.agentId)
  return c.json(managementAgentAccessRequestSchema.parse(request))
})

managementAgentsRoute.get('/access/requests/:requestId/decision', async (c) => {
  const request = await getManagementAgentAccessRequest(getDeps(c), c.req.param('requestId'))
  await requireAgentByIdManagementAccess(c, request.agentId)
  return c.json({ accessRequestId: request.id, status: request.status, decidedAt: request.decidedAt })
})

managementAgentsRoute.put('/access/requests/:requestId/decision', async (c) => {
  const request = await getManagementAgentAccessRequest(getDeps(c), c.req.param('requestId'))
  await requireAgentByIdManagementAccess(c, request.agentId)
  const actorUserId = requireHumanManagementActor(c)
  const decided = await decideAccessRequest(
    getDeps(c),
    request.id,
    await readJson(c, decideAccessRequestSchema),
    actorUserId,
  )
  return c.json({ accessRequestId: decided.id, status: decided.status, decidedAt: decided.decidedAt })
})

managementAgentsRoute.get('/access/authorizations', async (c) => {
  const query = readQuery(c, listManagementAgentAccessGrantsQuerySchema)
  return c.json(
    managementAgentAccessGrantsResponseSchema.parse(
      await listManagementAgentAccessGrants(getDeps(c), query, agentInventoryScope(c, query.organizationId)),
    ),
  )
})

managementAgentsRoute.get('/access/authorizations/:authorizationId', async (c) => {
  const grant = await getManagementAgentAccessGrant(getDeps(c), c.req.param('authorizationId'))
  await requireAgentByIdManagementAccess(c, grant.agentId)
  return c.json(managementAgentAccessGrantSchema.parse(grant))
})

managementAgentsRoute.get('/access/authorizations/:authorizationId/revocation', async (c) => {
  const grant = await getManagementAgentAccessGrant(getDeps(c), c.req.param('authorizationId'))
  await requireAgentByIdManagementAccess(c, grant.agentId)
  return c.json({ authorizationId: grant.id, status: grant.status })
})

managementAgentsRoute.put('/access/authorizations/:authorizationId/revocation', async (c) => {
  const grant = await getManagementAgentAccessGrant(getDeps(c), c.req.param('authorizationId'))
  await requireAgentByIdManagementAccess(c, grant.agentId)
  await revokeAgentAccessGrant(getDeps(c), grant.id, requireHumanManagementActor(c))
  return c.json({ authorizationId: grant.id, status: 'revoked' as const })
})

managementAgentsRoute.get('/agents/:agentId/retirement', async (c) => {
  const result = await getManagementAgent(getDeps(c), c.req.param('agentId'))
  requireAgentManagementAccess(c, result.agent)
  return c.json({ agentId: result.agent.id, status: result.agent.status, retiredAt: result.agent.retiredAt })
})

managementAgentsRoute.put('/agents/:agentId/retirement', async (c) => {
  await requireAgentByIdManagementAccess(c, c.req.param('agentId'))
  await emergencyRetireAgentIdentity(getDeps(c), c.req.param('agentId'), getManagementActor(c))
  return c.body(null, 204)
})

managementAgentsRoute.delete('/agents/:agentId/retirement', async (c) => {
  await requireAgentByIdManagementAccess(c, c.req.param('agentId'))
  await recoverAgentIdentity(getDeps(c), c.req.param('agentId'), getManagementActor(c))
  return c.body(null, 204)
})

managementAgentsRoute.get('/realm/audit-events', async (c) => {
  const query = readQuery(c, listAgentAuditEventsQuerySchema)
  const scope = agentInventoryScope(c, query.organizationId)
  if (query.agentId) {
    const agent = await getAgent(getDeps(c), query.agentId)
    requireAgentManagementAccess(c, agent)
  }
  const result = await getDeps(c).agentAudit.list(query, {
    agentIdentityId: query.agentId,
    ...scope,
  })
  return c.json({
    items: result.items.map((event) => agentAuditEventSchema.parse(event)),
    pagination: paginationMetadata({ ...query, total: result.total }),
  })
})

async function requireAgentByIdManagementAccess(c: Parameters<typeof getDeps>[0], agentId: string) {
  const agent = await getAgent(getDeps(c), agentId)
  requireAgentManagementAccess(c, agent)
}

function agentInventoryScope(c: Parameters<typeof getDeps>[0], requestedOrganizationId?: string) {
  const filter = resolveManagementOwnerFilter(
    getManagementBoundary(c),
    { organization: true, account: true },
    requestedOrganizationId,
  )
  if (!filter.ownerOrganizationIds && !filter.ownerUserId) return undefined
  return { ownerOrganizationIds: filter.ownerOrganizationIds, ownerUserId: filter.ownerUserId }
}

function requireAgentManagementAccess(c: Parameters<typeof getDeps>[0], agent: Awaited<ReturnType<typeof getAgent>>) {
  requireManagementOwner(getManagementBoundary(c), ownerFromAgentHomeSpace(agent.homeSpace))
}
