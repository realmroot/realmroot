import {
  emergencyRetireAgentIdentity,
  getAgent,
  getManagementAgent,
  listAllAgents,
  listManagementAgentAccessGrants,
  listManagementAgentAccessRequests,
  listManagementAgentHosts,
  listManagementAgentRoles,
} from '@server/usecases/agent-identities'
import {
  listAgentAuditEventsQuerySchema,
  listAgentsQuerySchema,
  managementAgentAccessGrantsResponseSchema,
  managementAgentAccessRequestsResponseSchema,
  managementAgentHostsResponseSchema,
  managementAgentResponseSchema,
  managementAgentRolesResponseSchema,
  managementAgentsResponseSchema,
} from '@shared/api/agent-api'
import { agentAuditEventSchema } from '@shared/api/agents'
import { paginationMetadata, paginationQuerySchema } from '@shared/api/pagination'
import { Hono } from 'hono'
import { getActorUserId } from '../../middleware/authn'
import {
  requireConsoleOrganizationAccess,
  requireRealmConsoleAccess,
  resolveOrganizationInventoryScope,
} from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readQuery } from '../validation'

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

managementAgentsRoute.get('/agents/:agentId/hosts', async (c) => {
  await requireAgentByIdConsoleAccess(c, c.req.param('agentId'))
  return c.json(
    managementAgentHostsResponseSchema.parse(
      await listManagementAgentHosts(getDeps(c), c.req.param('agentId'), readQuery(c, paginationQuerySchema)),
    ),
  )
})

managementAgentsRoute.get('/agents/:agentId/roles', async (c) => {
  await requireAgentByIdConsoleAccess(c, c.req.param('agentId'))
  return c.json(
    managementAgentRolesResponseSchema.parse(
      await listManagementAgentRoles(getDeps(c), c.req.param('agentId'), readQuery(c, paginationQuerySchema)),
    ),
  )
})

managementAgentsRoute.get('/agents/:agentId/access-requests', async (c) => {
  await requireAgentByIdConsoleAccess(c, c.req.param('agentId'))
  return c.json(
    managementAgentAccessRequestsResponseSchema.parse(
      await listManagementAgentAccessRequests(getDeps(c), c.req.param('agentId'), readQuery(c, paginationQuerySchema)),
    ),
  )
})

managementAgentsRoute.get('/agents/:agentId/access-grants', async (c) => {
  await requireAgentByIdConsoleAccess(c, c.req.param('agentId'))
  return c.json(
    managementAgentAccessGrantsResponseSchema.parse(
      await listManagementAgentAccessGrants(getDeps(c), c.req.param('agentId'), readQuery(c, paginationQuerySchema)),
    ),
  )
})

managementAgentsRoute.delete('/agents/:agentId', async (c) => {
  await emergencyRetireAgentIdentity(getDeps(c), c.req.param('agentId'), getActorUserId(c))
  return c.body(null, 204)
})

managementAgentsRoute.get('/audit-events', async (c) => {
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

function requireAgentConsoleAccess(c: Parameters<typeof getDeps>[0], agent: Awaited<ReturnType<typeof getAgent>>) {
  if (agent.homeSpace.type === 'organization') {
    requireConsoleOrganizationAccess(c, agent.homeSpace.organizationId)
    return
  }
  requireRealmConsoleAccess(c)
}
