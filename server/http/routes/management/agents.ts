import {
  emergencyActivateAgentIdentity,
  emergencyDeactivateAgentIdentity,
  emergencyDeleteAgentIdentity,
  getAgent,
  getManagementAgent,
  getManagementAgentAccessRequest,
  getManagementAgentPermission,
  listAllAgents,
  listManagementAgentAccessRequests,
  listManagementAgentAuthorizedResourceServers,
  listManagementAgentInstallations,
  listManagementAgentPermissions,
} from '@server/usecases/agent-identities'
import {
  decideAccessRequest,
  getAccessRequest,
  getAgentPermission,
  listAgentPermissions,
  revokeAgentPermission,
} from '@server/usecases/external-resources'
import {
  accessRequestSchema,
  agentAuthorizedResourceServersResponseSchema,
  agentPermissionSchema,
  agentPermissionsResponseSchema,
  decideAccessRequestSchema,
  listAgentAuditEventsQuerySchema,
  listAgentAuthorizedResourceServersQuerySchema,
  listAgentPermissionsQuerySchema,
  listAgentsQuerySchema,
  listManagementAgentAccessRequestsQuerySchema,
  managementAgentAccessRequestSchema,
  managementAgentAccessRequestsResponseSchema,
  managementAgentAuditEventSchema,
  managementAgentInstallationsResponseSchema,
  managementAgentResponseSchema,
  managementAgentsResponseSchema,
} from '@shared/api/agent-api'
import { paginationMetadata, paginationQuerySchema } from '@shared/api/pagination'
import { Hono } from 'hono'
import { getActorUserId, getPrincipal } from '../../middleware/authn'
import {
  authorizedTenantInventory,
  authorizeOrganization,
  authorizeUser,
  requireAgentScope,
} from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementAgentsRoute = new Hono()

managementAgentsRoute.get('/agents', async (c) => {
  const query = readQuery(c, listAgentsQuerySchema)
  return c.json(
    managementAgentsResponseSchema.parse(
      await listAllAgents(getDeps(c), query, await agentInventoryScope(c, query.organizationId)),
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

managementAgentsRoute.get('/agents/:agentId/authorized-resource-servers', async (c) => {
  const agentId = c.req.param('agentId')
  const principal = getPrincipal(c).agent
  if (principal) {
    if (principal.identityId !== agentId) return c.notFound()
    requireAgentScope(c, 'permissions:read')
  } else {
    await requireAgentByIdPermissionAccess(c, agentId)
  }
  return c.json(
    agentAuthorizedResourceServersResponseSchema.parse(
      await listManagementAgentAuthorizedResourceServers(
        getDeps(c),
        agentId,
        readQuery(c, listAgentAuthorizedResourceServersQuerySchema),
      ),
    ),
  )
})

managementAgentsRoute.get('/agents/:agentId/permissions', async (c) => {
  const principal = getPrincipal(c).agent
  if (principal) {
    if (principal.identityId !== c.req.param('agentId')) return c.notFound()
    requireAgentScope(c, 'permissions:read')
    return c.json(
      agentPermissionsResponseSchema.parse(
        await listAgentPermissions(getDeps(c), principal, readQuery(c, listAgentPermissionsQuerySchema)),
      ),
    )
  }
  await requireAgentByIdPermissionAccess(c, c.req.param('agentId'))
  const query = readQuery(c, listAgentPermissionsQuerySchema)
  return c.json(
    agentPermissionsResponseSchema.parse(
      await listManagementAgentPermissions(
        getDeps(c),
        { ...query, agentId: c.req.param('agentId') },
        await authorityInventoryScope(c),
      ),
    ),
  )
})

managementAgentsRoute.get('/agents/:agentId/permissions/:permissionId', async (c) => {
  const principal = getPrincipal(c).agent
  if (principal) {
    if (principal.identityId !== c.req.param('agentId')) return c.notFound()
    requireAgentScope(c, 'permissions:read')
    return c.json(
      agentPermissionSchema.parse(await getAgentPermission(getDeps(c), c.req.param('permissionId'), principal)),
    )
  }
  const grant = await getManagementAgentPermission(getDeps(c), c.req.param('permissionId'))
  if (grant.agentId !== c.req.param('agentId')) return c.notFound()
  await requireAgentByIdPermissionAccess(c, grant.agentId)
  return c.json(agentPermissionSchema.parse(grant))
})

managementAgentsRoute.delete('/agents/:agentId/permissions/:permissionId', async (c) => {
  const actorUserId = getActorUserId(c)
  if (!actorUserId) return c.notFound()
  const grant = await getManagementAgentPermission(getDeps(c), c.req.param('permissionId'))
  if (grant.agentId !== c.req.param('agentId')) return c.notFound()
  await requireAgentByIdPermissionAccess(c, grant.agentId, true)
  await revokeAgentPermission(getDeps(c), grant.id, actorUserId)
  return c.body(null, 204)
})

managementAgentsRoute.get('/agents/:agentId/activation', async (c) => {
  const result = await getManagementAgent(getDeps(c), c.req.param('agentId'))
  await requireAgentAccess(c, result.agent)
  return c.json({ agentId: result.agent.id, active: result.agent.status === 'active' })
})

managementAgentsRoute.put('/agents/:agentId/activation', async (c) => {
  const agent = await getAgent(getDeps(c), c.req.param('agentId'))
  await requireAgentAccess(c, agent, true)
  await emergencyActivateAgentIdentity(getDeps(c), c.req.param('agentId'), getActorUserId(c))
  return c.body(null, 204)
})

managementAgentsRoute.delete('/agents/:agentId/activation', async (c) => {
  const agent = await getAgent(getDeps(c), c.req.param('agentId'))
  await requireAgentAccess(c, agent, true)
  await emergencyDeactivateAgentIdentity(getDeps(c), c.req.param('agentId'), getActorUserId(c))
  return c.body(null, 204)
})

managementAgentsRoute.delete('/agents/:agentId', async (c) => {
  const agent = await getAgent(getDeps(c), c.req.param('agentId'))
  await requireAgentAccess(c, agent, true)
  await emergencyDeleteAgentIdentity(getDeps(c), c.req.param('agentId'), getActorUserId(c))
  return c.body(null, 204)
})

managementAgentsRoute.get('/realm/audit-events', async (c) => {
  const query = readQuery(c, listAgentAuditEventsQuerySchema)
  const tenants = await authorizedTenantInventory(c, 'audit-events:read')
  const organizationIds = tenants
    ? tenants.filter((tenant) => tenant.type === 'organization').map((tenant) => tenant.id)
    : query.organizationId
      ? [query.organizationId]
      : undefined
  const selectedOrganizationIds = query.organizationId
    ? organizationIds?.includes(query.organizationId)
      ? [query.organizationId]
      : []
    : organizationIds
  if (query.agentId) {
    const agent = await getAgent(getDeps(c), query.agentId)
    if (agent.homeSpace.type === 'organization') {
      await authorizeOrganization(c, agent.homeSpace.organizationId, 'audit-events:read')
    } else {
      await authorizeUser(c, agent.homeSpace.userId, 'audit-events:read')
    }
  }
  const result = await getDeps(c).agentAudit.list(query, {
    agentIdentityId: query.agentId,
    action: query.action,
    result: query.result,
    search: query.search,
    ownerUserId: query.organizationId ? undefined : tenants?.find((tenant) => tenant.type === 'user')?.id,
    ownerOrganizationIds: selectedOrganizationIds,
  })
  const resourceIds = [...new Set(result.items.flatMap((event) => (event.resourceId ? [event.resourceId] : [])))]
  const resources = await getDeps(c).authorization.findResources(resourceIds)
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]))
  return c.json({
    items: result.items.map((event) =>
      managementAgentAuditEventSchema.parse({
        ...event,
        resource: event.resourceId ? (resourcesById.get(event.resourceId) ?? null) : null,
      }),
    ),
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

async function requireAgentByIdPermissionAccess(c: Parameters<typeof getDeps>[0], agentId: string, write = false) {
  const agent = await getAgent(getDeps(c), agentId)
  const scope = write ? 'permissions:write' : 'permissions:read'
  if (agent.homeSpace.type === 'organization') await authorizeOrganization(c, agent.homeSpace.organizationId, scope)
  else await authorizeUser(c, agent.homeSpace.userId, scope)
}

async function authorityInventoryScope(c: Parameters<typeof getDeps>[0], requestedOrganizationId?: string) {
  const tenants = await authorizedTenantInventory(c, 'permissions:read')
  if (!tenants) return requestedOrganizationId ? { ownerOrganizationIds: [requestedOrganizationId] } : undefined
  const ownerOrganizationIds = tenants.filter((tenant) => tenant.type === 'organization').map((tenant) => tenant.id)
  return requestedOrganizationId
    ? { ownerOrganizationIds: ownerOrganizationIds.includes(requestedOrganizationId) ? [requestedOrganizationId] : [] }
    : { ownerOrganizationIds, ownerUserId: tenants.find((tenant) => tenant.type === 'user')?.id }
}

async function agentInventoryScope(c: Parameters<typeof getDeps>[0], requestedOrganizationId?: string) {
  const tenants = await authorizedTenantInventory(c, 'agents:read')
  if (!tenants) return requestedOrganizationId ? { ownerOrganizationIds: [requestedOrganizationId] } : undefined
  const ownerOrganizationIds = tenants.filter((tenant) => tenant.type === 'organization').map((tenant) => tenant.id)
  if (requestedOrganizationId) {
    return {
      ownerOrganizationIds: ownerOrganizationIds.includes(requestedOrganizationId) ? [requestedOrganizationId] : [],
    }
  }
  return {
    ownerUserId: tenants.find((tenant) => tenant.type === 'user')?.id,
    ownerOrganizationIds,
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
