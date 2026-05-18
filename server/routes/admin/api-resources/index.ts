import { Hono } from 'hono'
import {
  createApiPermissionRequestSchema,
  createApiResourceRequestSchema,
  createApiScopeRequestSchema,
  paginationQuerySchema,
  updateApiPermissionRequestSchema,
  updateApiResourceRequestSchema,
  updateApiScopeRequestSchema,
} from '../../../../shared/api/authorization'
import { requireAdmin } from '../../../middleware/admin'
import type { AuthorizationBindings } from '../../../modules/authorization/context'
import { createAuthorizationService } from '../../../modules/authorization/context'
import { readJson, readQuery } from '../../validation'

export const adminApiResourcesRoute = new Hono<{ Bindings: AuthorizationBindings }>()

adminApiResourcesRoute.use('*', requireAdmin())

adminApiResourcesRoute.get('/', async (c) =>
  c.json(await createAuthorizationService(c).listResources(readQuery(c, paginationQuerySchema))),
)

adminApiResourcesRoute.post('/', async (c) =>
  c.json(await createAuthorizationService(c).createResource(await readJson(c, createApiResourceRequestSchema)), 201),
)

adminApiResourcesRoute.get('/:resourceId', async (c) =>
  c.json(await createAuthorizationService(c).getResource(c.req.param('resourceId'))),
)

adminApiResourcesRoute.patch('/:resourceId', async (c) =>
  c.json(
    await createAuthorizationService(c).updateResource(
      c.req.param('resourceId'),
      await readJson(c, updateApiResourceRequestSchema),
    ),
  ),
)

adminApiResourcesRoute.delete('/:resourceId', async (c) => {
  await createAuthorizationService(c).deleteResource(c.req.param('resourceId'))
  return c.body(null, 204)
})

adminApiResourcesRoute.get('/:resourceId/scopes', async (c) =>
  c.json(
    await createAuthorizationService(c).listScopes(c.req.param('resourceId'), readQuery(c, paginationQuerySchema)),
  ),
)

adminApiResourcesRoute.post('/:resourceId/scopes', async (c) =>
  c.json(
    await createAuthorizationService(c).createScope(
      c.req.param('resourceId'),
      await readJson(c, createApiScopeRequestSchema),
    ),
    201,
  ),
)

adminApiResourcesRoute.patch('/:resourceId/scopes/:scopeId', async (c) =>
  c.json(
    await createAuthorizationService(c).updateScope(
      c.req.param('resourceId'),
      c.req.param('scopeId'),
      await readJson(c, updateApiScopeRequestSchema),
    ),
  ),
)

adminApiResourcesRoute.delete('/:resourceId/scopes/:scopeId', async (c) => {
  await createAuthorizationService(c).deleteScope(c.req.param('resourceId'), c.req.param('scopeId'))
  return c.body(null, 204)
})

adminApiResourcesRoute.get('/:resourceId/permissions', async (c) =>
  c.json(
    await createAuthorizationService(c).listPermissions(c.req.param('resourceId'), readQuery(c, paginationQuerySchema)),
  ),
)

adminApiResourcesRoute.post('/:resourceId/permissions', async (c) =>
  c.json(
    await createAuthorizationService(c).createPermission(
      c.req.param('resourceId'),
      await readJson(c, createApiPermissionRequestSchema),
    ),
    201,
  ),
)

adminApiResourcesRoute.patch('/:resourceId/permissions/:permissionId', async (c) =>
  c.json(
    await createAuthorizationService(c).updatePermission(
      c.req.param('resourceId'),
      c.req.param('permissionId'),
      await readJson(c, updateApiPermissionRequestSchema),
    ),
  ),
)

adminApiResourcesRoute.delete('/:resourceId/permissions/:permissionId', async (c) => {
  await createAuthorizationService(c).deletePermission(c.req.param('resourceId'), c.req.param('permissionId'))
  return c.body(null, 204)
})
