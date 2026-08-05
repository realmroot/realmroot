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
  authorizedOrganizationIds,
  authorizeOrganization,
  authorizeUser,
  requireAgentScope,
  requirePlatformAccess,
} from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementAgentsRoute = new Hono()

managementAgentsRoute.get('/agents', async (c) => {
  const query = readQuery(c, listAgentsQuerySchema)
  return c.json(
    managementAgentsResponseSchema.parse(
      await listAllAgents(getDeps(c), query, await organizationSelection(c, query.organizationId, 'agents:read')),
    ),
  )
})

managementAgentsRoute.get('/agents/:agentId', async (c) => {
  const result = await getManagementAgent(getDeps(c), c.req.param('agentId'))
  await requireAgentAccess(c, result.agent)
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
  if (principal) requireAgentScope(c, 'access-requests:read')
  return c.json(
    managementAgentAccessRequestsResponseSchema.parse(
      await listManagementAgentAccessRequests(
        getDeps(c),
        principal ? { ...query, agentId: principal.identityId } : query,
        principal ? undefined : await authorityInventoryScope(c, query.organizationId),
      ),
    ),
  )
})

managementAgentsRoute.get('/access/requests/:requestId', async (c) => {
  const principal = getPrincipal(c).agent
  if (principal) {
    requireAgentScope(c, 'access-requests:read')
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
    requireAgentScope(c, 'access-authorizations:read')
    return c.json(
      accessGrantsResponseSchema.parse(
        await listAgentAccessGrants(getDeps(c), principal, readQuery(c, paginationQuerySchema)),
      ),
    )
  }
  const query = readQuery(c, listManagementAgentAccessGrantsQuerySchema)
  return c.json(
    managementAgentAccessGrantsResponseSchema.parse(
      await listManagementAgentAccessGrants(getDeps(c), query, await authorityInventoryScope(c, query.organizationId)),
    ),
  )
})

managementAgentsRoute.get('/access/authorizations/:authorizationId', async (c) => {
  const principal = getPrincipal(c).agent
  if (principal) {
    requireAgentScope(c, 'access-authorizations:read')
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
  await requireAgentAccess(c, result.agent)
  return c.json({ agentId: result.agent.id, status: result.agent.status, retiredAt: result.agent.retiredAt })
})

managementAgentsRoute.put('/agents/:agentId/retirement', async (c) => {
  const agent = await getAgent(getDeps(c), c.req.param('agentId'))
  await requireAgentAccess(c, agent, true)
  await emergencyRetireAgentIdentity(getDeps(c), c.req.param('agentId'), getActorUserId(c))
  return c.body(null, 204)
})

managementAgentsRoute.delete('/agents/:agentId/retirement', async (c) => {
  const agent = await getAgent(getDeps(c), c.req.param('agentId'))
  await requireAgentAccess(c, agent, true)
  await recoverAgentIdentity(getDeps(c), c.req.param('agentId'), getActorUserId(c)!)
  return c.body(null, 204)
})

managementAgentsRoute.get('/realm/audit-events', async (c) => {
  const query = readQuery(c, listAgentAuditEventsQuerySchema)
  const organizationIds = await organizationSelection(c, query.organizationId, 'audit-events:read')
  if (query.agentId) {
    const agent = await getAgent(getDeps(c), query.agentId)
    if (agent.homeSpace.type === 'organization') {
      await authorizeOrganization(c, agent.homeSpace.organizationId, 'audit-events:read')
    } else {
      requirePlatformAccess(c, 'audit-events:read')
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
  await requireAgentAccess(c, agent)
}

async function requireAgentByIdAccess(c: Parameters<typeof getDeps>[0], agentId: string) {
  const agent = await getAgent(getDeps(c), agentId)
  await requireAgentAccess(c, agent, c.req.method !== 'GET' && c.req.method !== 'HEAD')
}

async function authorityInventoryScope(c: Parameters<typeof getDeps>[0], requestedOrganizationId?: string) {
  const organizationIds = await organizationSelection(c, requestedOrganizationId, 'agents:read')
  if (!organizationIds) return requestedOrganizationId ? { ownerOrganizationIds: [requestedOrganizationId] } : undefined
  return {
    ownerOrganizationIds: organizationIds,
  }
}

async function requireAgentAccess(
  c: Parameters<typeof getDeps>[0],
  agent: Awaited<ReturnType<typeof getAgent>>,
  write = false,
) {
  if (agent.homeSpace.type === 'organization') {
    await authorizeOrganization(c, agent.homeSpace.organizationId, write ? 'agents:write' : 'agents:read')
    return
  }
  await authorizeUser(c, agent.homeSpace.userId, write ? 'agents:write' : 'agents:read')
}

async function organizationSelection(
  c: Parameters<typeof getDeps>[0],
  requestedOrganizationId: string | undefined,
  scope: 'agents:read' | 'audit-events:read',
) {
  const allowed = await authorizedOrganizationIds(c, scope)
  if (!allowed) return requestedOrganizationId ? [requestedOrganizationId] : undefined
  if (!requestedOrganizationId) return allowed
  return allowed.includes(requestedOrganizationId) ? [requestedOrganizationId] : []
}
