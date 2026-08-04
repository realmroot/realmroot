import {
  archiveResource,
  createResource,
  deleteResource,
  getResourceContract,
  restoreResource,
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
  requireConsoleOrganizationAccess,
  requireConsoleOwnedOrganization,
  resolveOrganizationInventoryScope,
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
        await listApiResources(getDeps(c), query, resolveOrganizationInventoryScope(c, query.ownerOrganizationId)),
      ),
    )
  })

  app.post('/', async (c) => {
    const input = await readJson(c, createApiResourceSchema)
    requireConsoleOwnedOrganization(c, input.ownerOrganizationId)
    const resource = await createResource(getDeps(c), input)
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
    if (input.ownerOrganizationId !== undefined) requireConsoleOwnedOrganization(c, input.ownerOrganizationId)
    await updateResource(getDeps(c), c.req.param('resourceId'), input)
    return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), c.req.param('resourceId'))))
  })

  app.delete('/:resourceId', async (c) => {
    await requireResourceAccess(c)
    await deleteResource(getDeps(c), c.req.param('resourceId'))
    return c.body(null, 204)
  })

  return app
    .get('/:resourceId/archival', async (c) => {
      const resource = await requireResourceAccess(c)
      return c.json({ resourceServerId: resource.id, archivedAt: resource.archivedAt })
    })
    .put('/:resourceId/archival', async (c) => {
      await requireResourceAccess(c)
      await archiveResource(getDeps(c), c.req.param('resourceId'), resourceMutationActor(c))
      return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), c.req.param('resourceId'))))
    })
    .delete('/:resourceId/archival', async (c) => {
      await requireResourceAccess(c)
      await restoreResource(getDeps(c), c.req.param('resourceId'), resourceMutationActor(c))
      return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), c.req.param('resourceId'))))
    })
}

async function requireResourceAccess(c: Parameters<typeof getPrincipal>[0]) {
  const resource = await getApiResource(getDeps(c), c.req.param('resourceId')!)
  requireConsoleOrganizationAccess(c, resource.ownerOrganizationId)
  return resource
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
