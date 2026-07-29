import {
  createPermission,
  createResource,
  createScope,
  deletePermission,
  deleteResource,
  deleteScope,
  listPermissions,
  listScopes,
  updatePermission,
  updateResource,
  updateScope,
} from '@server/usecases/authorization'
import {
  configureExternalResourceAuthorization,
  getApiResource,
  listApiResources,
} from '@server/usecases/external-resources'
import {
  apiResourceSchema,
  apiResourcesResponseSchema,
  createApiResourceSchema,
  updateApiResourceSchema,
} from '@shared/api/agent-api'
import {
  createApiPermissionRequestSchema,
  createApiScopeRequestSchema,
  paginationQuerySchema,
  updateApiPermissionRequestSchema,
  updateApiScopeRequestSchema,
} from '@shared/api/authorization'
import { Hono } from 'hono'
import { requireAdmin } from '../../middleware/admin'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export function createManagementApiResourcesRoute(canonicalOrigin?: string) {
  const app = new Hono()

  app.use('*', requireAdmin())

  app.get('/', async (c) =>
    c.json(apiResourcesResponseSchema.parse(await listApiResources(getDeps(c), readQuery(c, paginationQuerySchema)))),
  )

  app.post('/', async (c) => {
    const input = await readJson(c, createApiResourceSchema)
    const { authorization, ...resourceInput } = input
    const resource = await createResource(getDeps(c), resourceInput)
    if (authorization) {
      await configureExternalResourceAuthorization(getDeps(c), resource.id, authorization, requireCanonicalOrigin())
    }
    c.header('Location', `/api/management/api-resources/${encodeURIComponent(resource.id)}`)
    return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), resource.id)), 201)
  })

  app.get('/:resourceId', async (c) =>
    c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), c.req.param('resourceId')))),
  )

  app.patch('/:resourceId', async (c) => {
    const input = await readJson(c, updateApiResourceSchema)
    const { authorization, ...resourceInput } = input
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

  app.get('/:resourceId/scopes', async (c) =>
    c.json(await listScopes(getDeps(c), c.req.param('resourceId'), readQuery(c, paginationQuerySchema))),
  )

  app.post('/:resourceId/scopes', async (c) =>
    c.json(
      await createScope(getDeps(c), c.req.param('resourceId'), await readJson(c, createApiScopeRequestSchema)),
      201,
    ),
  )

  app.patch('/:resourceId/scopes/:scopeId', async (c) =>
    c.json(
      await updateScope(
        getDeps(c),
        c.req.param('resourceId'),
        c.req.param('scopeId'),
        await readJson(c, updateApiScopeRequestSchema),
      ),
    ),
  )

  app.delete('/:resourceId/scopes/:scopeId', async (c) => {
    await deleteScope(getDeps(c), c.req.param('resourceId'), c.req.param('scopeId'))
    return c.body(null, 204)
  })

  app.get('/:resourceId/permissions', async (c) =>
    c.json(await listPermissions(getDeps(c), c.req.param('resourceId'), readQuery(c, paginationQuerySchema))),
  )

  app.post('/:resourceId/permissions', async (c) =>
    c.json(
      await createPermission(
        getDeps(c),
        c.req.param('resourceId'),
        await readJson(c, createApiPermissionRequestSchema),
      ),
      201,
    ),
  )

  app.patch('/:resourceId/permissions/:permissionId', async (c) =>
    c.json(
      await updatePermission(
        getDeps(c),
        c.req.param('resourceId'),
        c.req.param('permissionId'),
        await readJson(c, updateApiPermissionRequestSchema),
      ),
    ),
  )

  app.delete('/:resourceId/permissions/:permissionId', async (c) => {
    await deletePermission(getDeps(c), c.req.param('resourceId'), c.req.param('permissionId'))
    return c.body(null, 204)
  })

  return app

  function requireCanonicalOrigin() {
    if (!canonicalOrigin) throw new Error('External API resource registration requires the configured base URL.')
    return canonicalOrigin.replace(/\/$/, '')
  }
}
