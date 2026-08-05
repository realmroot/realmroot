import {
  emergencyRecoverAgentIdentity,
  emergencyRetireAgentIdentity,
  getAgent,
  getManagementAgent,
  getManagementAgentAccessGrant,
  getManagementAgentAccessRequest,
  listAllAgents,
  listManagementAgentAccessGrants,
  listManagementAgentAccessRequests,
  listManagementAgentInstallations,
} from '@server/usecases/agent-identities'
import {
  decideManagementAccessRequest,
  getAccessRequest,
  getAgentAccessGrant,
  listAgentAccessGrants,
  revokeManagementAgentAccessGrant,
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
import { managementOwnerFilter, requireManagementOwner } from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementAgentsRoute = new Hono()

managementAgentsRoute.get('/agents', async (c) => {
  const query = readQuery(c, listAgentsQuerySchema)
  return c.json(
    managementAgentsResponseSchema.parse(
      await listAllAgents(getDeps(c), query, managementOwnerFilter(c, query.organizationId)),
    ),
  )
})

managementAgentsRoute.get('/agents/:agentId', async (c) => {
  const result = await getManagementAgent(getDeps(c), c.req.param('agentId'))
  requireAgentOwner(c, result.agent)
  return c.json(managementAgentResponseSchema.parse(result))
})

managementAgentsRoute.get('/agents/:agentId/installations', async (c) => {
  await requireAgentByIdAccess(c, c.req.param('agentId'))
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
        principal ? undefined : managementOwnerFilter(c, query.organizationId),
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
  const principal = getPrincipal(c)
  const decided = await decideManagementAccessRequest(
    getDeps(c),
    request.id,
    await readJson(c, decideAccessRequestSchema),
    principal.agent ? { principal: principal.agent } : { userId: principal.user!.id },
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
      await listManagementAgentAccessGrants(getDeps(c), query, managementOwnerFilter(c, query.organizationId)),
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
  const principal = getPrincipal(c)
  await revokeManagementAgentAccessGrant(
    getDeps(c),
    grant.id,
    principal.agent ? { principal: principal.agent } : { userId: principal.user!.id },
  )
  return c.json({ authorizationId: grant.id, status: 'revoked' as const })
})

managementAgentsRoute.get('/agents/:agentId/retirement', async (c) => {
  const result = await getManagementAgent(getDeps(c), c.req.param('agentId'))
  requireAgentOwner(c, result.agent)
  return c.json({ agentId: result.agent.id, status: result.agent.status, retiredAt: result.agent.retiredAt })
})

managementAgentsRoute.put('/agents/:agentId/retirement', async (c) => {
  await requireAgentByIdAccess(c, c.req.param('agentId'))
  await emergencyRetireAgentIdentity(getDeps(c), c.req.param('agentId'), getActorUserId(c))
  return c.body(null, 204)
})

managementAgentsRoute.delete('/agents/:agentId/retirement', async (c) => {
  await requireAgentByIdAccess(c, c.req.param('agentId'))
  await emergencyRecoverAgentIdentity(getDeps(c), c.req.param('agentId'), getActorUserId(c))
  return c.body(null, 204)
})

managementAgentsRoute.get('/realm/audit-events', async (c) => {
  const query = readQuery(c, listAgentAuditEventsQuerySchema)
  const ownerFilter = managementOwnerFilter(c, query.organizationId)
  if (query.agentId) {
    const agent = await getAgent(getDeps(c), query.agentId)
    if (agent.homeSpace.type === 'organization') {
      requireAgentOwner(c, agent)
    } else {
      requireAgentOwner(c, agent)
    }
  }
  const result = await getDeps(c).agentAudit.list(query, {
    agentIdentityId: query.agentId,
    ownerUserId: ownerFilter?.ownerUserId,
    ownerOrganizationIds: ownerFilter?.ownerOrganizationIds,
  })
  return c.json({
    items: result.items.map((event) => agentAuditEventSchema.parse(event)),
    pagination: paginationMetadata({ ...query, total: result.total }),
  })
})

async function requireAgentByIdAccess(c: Parameters<typeof getDeps>[0], agentId: string) {
  const agent = await getAgent(getDeps(c), agentId)
  requireAgentOwner(c, agent)
}

function requireAgentOwner(c: Parameters<typeof getDeps>[0], agent: Awaited<ReturnType<typeof getAgent>>) {
  requireManagementOwner(
    c,
    agent.homeSpace.type === 'personal'
      ? { kind: 'account', accountId: agent.homeSpace.userId }
      : { kind: 'organization', organizationId: agent.homeSpace.organizationId },
  )
}
