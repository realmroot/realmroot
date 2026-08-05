import {
  archiveResource,
  createResource,
  deleteResource,
  ensureRealmrootResourceServer,
  getResourceContract,
  restoreResource,
  updateResource,
} from '@server/usecases/authorization'
import { getApiResource, listApiResources } from '@server/usecases/external-resources'
import {
  apiResourceSchema,
  apiResourcesResponseSchema,
  createApiResourceSchema,
  updateApiResourceSchema,
} from '@shared/api/agent-api'
import { apiResourceContractResponseSchema, listApiResourcesQuerySchema } from '@shared/api/authorization'
import { Hono } from 'hono'
import {
  getManagementActor,
  requireManagementOrganization,
  requireManagementOwnedOrganization,
  resolveManagementOrganizationIds,
} from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export function createManagementApiResourcesRoute(canonicalOrigin?: string) {
  const app = new Hono()

  if (canonicalOrigin) {
    app.use('*', async (c, next) => {
      await ensureRealmrootResourceServer(getDeps(c), canonicalOrigin)
      await next()
    })
  }

  app.get('/', async (c) => {
    const query = readQuery(c, listApiResourcesQuerySchema)
    return c.json(
      apiResourcesResponseSchema.parse(
        await listApiResources(getDeps(c), query, resolveManagementOrganizationIds(c, query.ownerOrganizationId)),
      ),
    )
  })

  app.post('/', async (c) => {
    const input = await readJson(c, createApiResourceSchema)
    requireManagementOwnedOrganization(c, input.ownerOrganizationId)
    const resource = await createResource(getDeps(c), input, getManagementActor(c))
    c.header('Location', `/api/resource-servers/${encodeURIComponent(resource.id)}`)
    return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), resource.id)), 201)
  })

  app.get('/:resourceId', async (c) => {
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
    if (input.ownerOrganizationId !== undefined) requireManagementOwnedOrganization(c, input.ownerOrganizationId)
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

async function requireResourceAccess(c: Parameters<typeof getManagementActor>[0]) {
  const resource = await getApiResource(getDeps(c), c.req.param('resourceId')!)
  requireManagementOrganization(c, resource.ownerOrganizationId)
  return resource
}

function resourceMutationActor(c: Parameters<typeof getManagementActor>[0]) {
  return getManagementActor(c)
}
