import {
  archiveResource,
  createResource,
  deleteResource,
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
import { paginationQuerySchema } from '@shared/api/authorization'
import { Hono } from 'hono'
import { getPrincipal } from '../../middleware/authn'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export function createManagementApiResourcesRoute() {
  const app = new Hono()

  app.get('/', async (c) =>
    c.json(apiResourcesResponseSchema.parse(await listApiResources(getDeps(c), readQuery(c, paginationQuerySchema)))),
  )

  app.post('/', async (c) => {
    const input = await readJson(c, createApiResourceSchema)
    const resource = await createResource(getDeps(c), input)
    c.header('Location', `/api/api-resources/${encodeURIComponent(resource.id)}`)
    return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), resource.id)), 201)
  })

  app.get('/:resourceId', async (c) =>
    c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), c.req.param('resourceId')))),
  )

  app.patch('/:resourceId', async (c) => {
    const input = await readJson(c, updateApiResourceSchema)
    await updateResource(getDeps(c), c.req.param('resourceId'), input)
    return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), c.req.param('resourceId'))))
  })

  app.delete('/:resourceId', async (c) => {
    await deleteResource(getDeps(c), c.req.param('resourceId'))
    return c.body(null, 204)
  })

  return app
    .put('/:resourceId/archival', async (c) => {
      await archiveResource(getDeps(c), c.req.param('resourceId'), resourceMutationActor(c))
      return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), c.req.param('resourceId'))))
    })
    .delete('/:resourceId/archival', async (c) => {
      await restoreResource(getDeps(c), c.req.param('resourceId'), resourceMutationActor(c))
      return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), c.req.param('resourceId'))))
    })
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
