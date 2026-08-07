import {
  createResource,
  deleteResource,
  getResourceContract,
  refreshResourceScopeRegistry,
  updateResource,
} from '@server/usecases/authorization'
import {
  getAgentResourceServer,
  getApiResource,
  listAgentResourceServers,
  listApiResources,
} from '@server/usecases/external-resources'
import {
  apiResourceSchema,
  apiResourcesResponseSchema,
  createApiResourceSchema,
  updateApiResourceSchema,
} from '@shared/api/agent-api'
import { apiResourceContractResponseSchema, listApiResourcesQuerySchema } from '@shared/api/authorization'
import { Hono } from 'hono'
import { getPrincipal } from '../../middleware/authn'
import {
  authorizedOrganizationIds,
  authorizedOrganizationOwnerId,
  authorizeOrganization,
  authorizeOrganizationOwner,
} from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export function createManagementApiResourcesRoute() {
  const app = new Hono()

  app.get('/', async (c) => {
    const principal = getPrincipal(c).agent
    if (principal) {
      return c.json(
        await listAgentResourceServers(
          getDeps(c),
          principal,
          readQuery(c, listApiResourcesQuerySchema.pick({ limit: true, offset: true })),
          new URL(c.req.url).origin,
        ),
      )
    }
    const query = readQuery(c, listApiResourcesQuerySchema)
    return c.json(
      apiResourcesResponseSchema.parse(
        await listApiResources(getDeps(c), query, await filterOrganizationSelection(c, query.ownerOrganizationId)),
      ),
    )
  })

  app.post('/', async (c) => {
    const input = await readJson(c, createApiResourceSchema)
    const owner = await authorizeOrganizationOwner(c, input.ownerOrganizationId, 'resource-servers:write')
    const resource = await createResource(getDeps(c), {
      ...input,
      ownerOrganizationId: authorizedOrganizationOwnerId(owner),
    })
    c.header('Location', `/api/resource-servers/${encodeURIComponent(resource.id)}`)
    return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), resource.id)), 201)
  })

  app.get('/:resourceId', async (c) => {
    const principal = getPrincipal(c).agent
    if (principal) {
      return c.json(
        await getAgentResourceServer(getDeps(c), c.req.param('resourceId'), principal, new URL(c.req.url).origin),
      )
    }
    return c.json(apiResourceSchema.parse(await requireResourceAccess(c)))
  })

  app.get('/:resourceId/contract', async (c) => {
    await requireResourceAccess(c)
    return c.json(
      apiResourceContractResponseSchema.parse(await getResourceContract(getDeps(c), c.req.param('resourceId'))),
    )
  })

  app.patch('/:resourceId', async (c) => {
    await requireResourceAccess(c)
    const input = await readJson(c, updateApiResourceSchema)
    const owner = input.ownerOrganizationId
      ? await authorizeOrganizationOwner(c, input.ownerOrganizationId, 'resource-servers:write')
      : null
    await updateResource(getDeps(c), c.req.param('resourceId'), {
      ...input,
      ...(owner ? { ownerOrganizationId: authorizedOrganizationOwnerId(owner) } : {}),
    })
    return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), c.req.param('resourceId'))))
  })

  app.delete('/:resourceId', async (c) => {
    await requireResourceAccess(c)
    await deleteResource(getDeps(c), c.req.param('resourceId'), resourceMutationActor(c))
    return c.body(null, 204)
  })

  return app.put('/:resourceId/scope-registry', async (c) => {
    await requireResourceAccess(c)
    await refreshResourceScopeRegistry(getDeps(c), c.req.param('resourceId'))
    return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), c.req.param('resourceId'))))
  })
}

async function requireResourceAccess(c: Parameters<typeof getPrincipal>[0]) {
  const resource = await getApiResource(getDeps(c), c.req.param('resourceId')!)
  await authorizeOrganization(
    c,
    resource.ownerOrganizationId,
    c.req.method === 'GET' || c.req.method === 'HEAD' ? 'resource-servers:read' : 'resource-servers:write',
  )
  return resource
}

async function filterOrganizationSelection(c: Parameters<typeof getPrincipal>[0], requestedOrganizationId?: string) {
  const allowed = await authorizedOrganizationIds(c, 'resource-servers:read')
  if (!allowed) return requestedOrganizationId ? [requestedOrganizationId] : undefined
  if (!requestedOrganizationId) return allowed
  return allowed.includes(requestedOrganizationId) ? [requestedOrganizationId] : []
}

function resourceMutationActor(c: Parameters<typeof getPrincipal>[0]) {
  const principal = getPrincipal(c)
  return {
    controllerUserId: principal.user?.id ?? null,
    agent: principal.agent
      ? {
          issuer: principal.agent.issuer,
          subject: principal.agent.subject,
          identityId: principal.agent.identityId,
          hostId: principal.agent.hostId,
        }
      : null,
  }
}
