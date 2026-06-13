import {
  createPermission,
  createResource,
  createScope,
  deletePermission,
  deleteResource,
  deleteScope,
  getResource,
  listPermissions,
  listResources,
  listScopes,
  updatePermission,
  updateResource,
  updateScope,
} from '@server/usecases/authorization'
import {
  createApiPermissionRequestSchema,
  createApiResourceRequestSchema,
  createApiScopeRequestSchema,
  paginationQuerySchema,
  updateApiPermissionRequestSchema,
  updateApiResourceRequestSchema,
  updateApiScopeRequestSchema,
} from '@shared/api/authorization'
import { Hono } from 'hono'
import { requireAdmin } from '../../middleware/admin'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementApiResourcesRoute = new Hono()

managementApiResourcesRoute.use('*', requireAdmin())

managementApiResourcesRoute.get('/', async (c) =>
  c.json(await listResources(getDeps(c), readQuery(c, paginationQuerySchema))),
)

managementApiResourcesRoute.post('/', async (c) =>
  c.json(await createResource(getDeps(c), await readJson(c, createApiResourceRequestSchema)), 201),
)

managementApiResourcesRoute.get('/:resourceId', async (c) =>
  c.json(await getResource(getDeps(c), c.req.param('resourceId'))),
)

managementApiResourcesRoute.patch('/:resourceId', async (c) =>
  c.json(
    await updateResource(getDeps(c), c.req.param('resourceId'), await readJson(c, updateApiResourceRequestSchema)),
  ),
)

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
