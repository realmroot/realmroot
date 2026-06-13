import type { AuthorizationBindings } from '@server/modules/authorization/context'
import { createAuthorizationService } from '@server/modules/authorization/context'
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
import { readJson, readQuery } from '../validation'

export const managementApiResourcesRoute = new Hono<{ Bindings: AuthorizationBindings }>()

managementApiResourcesRoute.use('*', requireAdmin())

managementApiResourcesRoute.get('/', async (c) =>
  c.json(await createAuthorizationService(c).listResources(readQuery(c, paginationQuerySchema))),
)

managementApiResourcesRoute.post('/', async (c) =>
  c.json(await createAuthorizationService(c).createResource(await readJson(c, createApiResourceRequestSchema)), 201),
)

managementApiResourcesRoute.get('/:resourceId', async (c) =>
  c.json(await createAuthorizationService(c).getResource(c.req.param('resourceId'))),
)

managementApiResourcesRoute.patch('/:resourceId', async (c) =>
  c.json(
    await createAuthorizationService(c).updateResource(
      c.req.param('resourceId'),
      await readJson(c, updateApiResourceRequestSchema),
    ),
  ),
)

managementApiResourcesRoute.delete('/:resourceId', async (c) => {
  await createAuthorizationService(c).deleteResource(c.req.param('resourceId'))
  return c.body(null, 204)
})

managementApiResourcesRoute.get('/:resourceId/scopes', async (c) =>
  c.json(
    await createAuthorizationService(c).listScopes(c.req.param('resourceId'), readQuery(c, paginationQuerySchema)),
  ),
)

managementApiResourcesRoute.post('/:resourceId/scopes', async (c) =>
  c.json(
    await createAuthorizationService(c).createScope(
      c.req.param('resourceId'),
      await readJson(c, createApiScopeRequestSchema),
    ),
    201,
  ),
)

managementApiResourcesRoute.patch('/:resourceId/scopes/:scopeId', async (c) =>
  c.json(
    await createAuthorizationService(c).updateScope(
      c.req.param('resourceId'),
      c.req.param('scopeId'),
      await readJson(c, updateApiScopeRequestSchema),
    ),
  ),
)

managementApiResourcesRoute.delete('/:resourceId/scopes/:scopeId', async (c) => {
  await createAuthorizationService(c).deleteScope(c.req.param('resourceId'), c.req.param('scopeId'))
  return c.body(null, 204)
})

managementApiResourcesRoute.get('/:resourceId/permissions', async (c) =>
  c.json(
    await createAuthorizationService(c).listPermissions(c.req.param('resourceId'), readQuery(c, paginationQuerySchema)),
  ),
)

managementApiResourcesRoute.post('/:resourceId/permissions', async (c) =>
  c.json(
    await createAuthorizationService(c).createPermission(
      c.req.param('resourceId'),
      await readJson(c, createApiPermissionRequestSchema),
    ),
    201,
  ),
)

managementApiResourcesRoute.patch('/:resourceId/permissions/:permissionId', async (c) =>
  c.json(
    await createAuthorizationService(c).updatePermission(
      c.req.param('resourceId'),
      c.req.param('permissionId'),
      await readJson(c, updateApiPermissionRequestSchema),
    ),
  ),
)

managementApiResourcesRoute.delete('/:resourceId/permissions/:permissionId', async (c) => {
  await createAuthorizationService(c).deletePermission(c.req.param('resourceId'), c.req.param('permissionId'))
  return c.body(null, 204)
})
