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

export const managementApiResourcesRoute = new Hono()

managementApiResourcesRoute.use('*', requireAdmin())

managementApiResourcesRoute.get('/', async (c) =>
  c.json(apiResourcesResponseSchema.parse(await listApiResources(getDeps(c), readQuery(c, paginationQuerySchema)))),
)

managementApiResourcesRoute.post('/', async (c) => {
  const input = await readJson(c, createApiResourceSchema)
  const { authorization, ...resourceInput } = input
  const resource = await createResource(getDeps(c), resourceInput)
  if (authorization) {
    await configureExternalResourceAuthorization(getDeps(c), resource.id, authorization, new URL(c.req.url).origin)
  }
  c.header('Location', `/api/management/api-resources/${encodeURIComponent(resource.id)}`)
  return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), resource.id)), 201)
})

managementApiResourcesRoute.get('/:resourceId', async (c) =>
  c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), c.req.param('resourceId')))),
)

managementApiResourcesRoute.patch('/:resourceId', async (c) => {
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
      new URL(c.req.url).origin,
    )
  }
  return c.json(apiResourceSchema.parse(await getApiResource(getDeps(c), c.req.param('resourceId'))))
})

managementApiResourcesRoute.delete('/:resourceId', async (c) => {
  await deleteResource(getDeps(c), c.req.param('resourceId'))
  return c.body(null, 204)
})

managementApiResourcesRoute.get('/:resourceId/scopes', async (c) =>
  c.json(await listScopes(getDeps(c), c.req.param('resourceId'), readQuery(c, paginationQuerySchema))),
)

managementApiResourcesRoute.post('/:resourceId/scopes', async (c) =>
  c.json(await createScope(getDeps(c), c.req.param('resourceId'), await readJson(c, createApiScopeRequestSchema)), 201),
)

managementApiResourcesRoute.patch('/:resourceId/scopes/:scopeId', async (c) =>
  c.json(
    await updateScope(
      getDeps(c),
      c.req.param('resourceId'),
      c.req.param('scopeId'),
      await readJson(c, updateApiScopeRequestSchema),
    ),
  ),
)

managementApiResourcesRoute.delete('/:resourceId/scopes/:scopeId', async (c) => {
  await deleteScope(getDeps(c), c.req.param('resourceId'), c.req.param('scopeId'))
  return c.body(null, 204)
})

managementApiResourcesRoute.get('/:resourceId/permissions', async (c) =>
  c.json(await listPermissions(getDeps(c), c.req.param('resourceId'), readQuery(c, paginationQuerySchema))),
)

managementApiResourcesRoute.post('/:resourceId/permissions', async (c) =>
  c.json(
    await createPermission(getDeps(c), c.req.param('resourceId'), await readJson(c, createApiPermissionRequestSchema)),
    201,
  ),
)

managementApiResourcesRoute.patch('/:resourceId/permissions/:permissionId', async (c) =>
  c.json(
    await updatePermission(
      getDeps(c),
      c.req.param('resourceId'),
      c.req.param('permissionId'),
      await readJson(c, updateApiPermissionRequestSchema),
    ),
  ),
)

managementApiResourcesRoute.delete('/:resourceId/permissions/:permissionId', async (c) => {
  await deletePermission(getDeps(c), c.req.param('resourceId'), c.req.param('permissionId'))
  return c.body(null, 204)
})
