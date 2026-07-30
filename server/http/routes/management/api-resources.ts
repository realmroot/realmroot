import { badRequest } from '@server/domain/errors'
import {
  archiveResource,
  createResource,
  deleteResource,
  restoreResource,
  updateResource,
} from '@server/usecases/authorization'
import {
  configureExternalResourceAuthorization,
  createExternalApiResource,
  getApiResource,
  listApiResources,
} from '@server/usecases/external-resources'
import {
  apiResourceSchema,
  apiResourcesResponseSchema,
  createApiResourceSchema,
  updateApiResourceSchema,
} from '@shared/api/agent-api'
import { paginationQuerySchema } from '@shared/api/authorization'
import { Hono } from 'hono'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export function createManagementApiResourcesRoute(canonicalOrigin?: string) {
  const app = new Hono()

  app.get('/', async (c) =>
    c.json(apiResourcesResponseSchema.parse(await listApiResources(getDeps(c), readQuery(c, paginationQuerySchema)))),
  )

  app.post('/', async (c) => {
    const input = await readJson(c, createApiResourceSchema)
    const { authorization, ...resourceInput } = input
    const resource = authorization
      ? await createExternalApiResource(getDeps(c), resourceInput, authorization, requireCanonicalOrigin())
      : await createResource(getDeps(c), resourceInput)
    c.header('Location', `/api/api-resources/${encodeURIComponent(resource.id)}`)
    return c.json(
      apiResourceSchema.parse(authorization ? resource : await getApiResource(getDeps(c), resource.id)),
      201,
    )
  })

  app.get('/:resourceId', async (c) =>
    c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), c.req.param('resourceId')))),
  )

  app.patch('/:resourceId', async (c) => {
    const input = await readJson(c, updateApiResourceSchema)
    const { authorization, ...resourceInput } = input
    if (resourceInput.resourceUrl !== undefined && !authorization) {
      const current = await getApiResource(getDeps(c), c.req.param('resourceId'))
      if (current.authorizationMode === 'external' && current.resourceUrl !== resourceInput.resourceUrl) {
        throw badRequest('Changing an external API resource URL requires authorization reconfiguration.')
      }
    }
    if (Object.keys(resourceInput).length > 0) {
      await updateResource(getDeps(c), c.req.param('resourceId'), resourceInput)
    }
    if (authorization) {
      await configureExternalResourceAuthorization(
        getDeps(c),
        c.req.param('resourceId'),
        authorization,
        requireCanonicalOrigin(),
      )
    }
    return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), c.req.param('resourceId'))))
  })

  app.delete('/:resourceId', async (c) => {
    await deleteResource(getDeps(c), c.req.param('resourceId'))
    return c.body(null, 204)
  })

  return app
    .put('/:resourceId/archival', async (c) => {
      await archiveResource(getDeps(c), c.req.param('resourceId'))
      return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), c.req.param('resourceId'))))
    })
    .delete('/:resourceId/archival', async (c) => {
      await restoreResource(getDeps(c), c.req.param('resourceId'))
      return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), c.req.param('resourceId'))))
    })

  function requireCanonicalOrigin() {
    if (!canonicalOrigin) throw new Error('External API resource registration requires the configured base URL.')
    return canonicalOrigin.replace(/\/$/, '')
  }
}
