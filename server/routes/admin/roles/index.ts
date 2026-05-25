import { Hono } from 'hono'
import {
  assignRoleRequestSchema,
  createRoleRequestSchema,
  paginationQuerySchema,
  replaceRolePermissionsRequestSchema,
  updateRoleRequestSchema,
} from '../../../../shared/api/authorization'
import { requireAdmin } from '../../../middleware/admin'
import { getAuthContext } from '../../../middleware/auth-context'
import type { AuthorizationBindings } from '../../../modules/authorization/context'
import { createAuthorizationService } from '../../../modules/authorization/context'
import { readJson, readQuery } from '../../validation'

export const adminRolesRoute = new Hono<{ Bindings: AuthorizationBindings }>()

adminRolesRoute.use('*', requireAdmin())

adminRolesRoute.get('/', async (c) =>
  c.json(await createAuthorizationService(c).listRoles(readQuery(c, paginationQuerySchema))),
)

adminRolesRoute.post('/', async (c) =>
  c.json(await createAuthorizationService(c).createRole(await readJson(c, createRoleRequestSchema)), 201),
)

adminRolesRoute.get('/:roleId', async (c) => c.json(await createAuthorizationService(c).getRole(c.req.param('roleId'))))

adminRolesRoute.patch('/:roleId', async (c) =>
  c.json(
    await createAuthorizationService(c).updateRole(c.req.param('roleId'), await readJson(c, updateRoleRequestSchema)),
  ),
)

adminRolesRoute.delete('/:roleId', async (c) => {
  await createAuthorizationService(c).deleteRole(c.req.param('roleId'))
  return c.body(null, 204)
})

adminRolesRoute.get('/:roleId/permissions', async (c) =>
  c.json(await createAuthorizationService(c).listRolePermissions(c.req.param('roleId'))),
)

adminRolesRoute.put('/:roleId/permissions', async (c) => {
  const body = await readJson(c, replaceRolePermissionsRequestSchema)
  await createAuthorizationService(c).replaceRolePermissions(c.req.param('roleId'), body.permissionIds)
  return c.body(null, 204)
})

adminRolesRoute.post('/assignments/users', async (c) => {
  const { user } = getAuthContext(c)
  await createAuthorizationService(c).assignUserRole(await readJson(c, assignRoleRequestSchema), user!.id)
  return c.body(null, 204)
})

adminRolesRoute.post('/assignments/applications', async (c) => {
  const { user } = getAuthContext(c)
  await createAuthorizationService(c).assignApplicationRole(await readJson(c, assignRoleRequestSchema), user!.id)
  return c.body(null, 204)
})

adminRolesRoute.post('/assignments/members', async (c) => {
  const { user } = getAuthContext(c)
  await createAuthorizationService(c).assignMemberRole(await readJson(c, assignRoleRequestSchema), user!.id)
  return c.body(null, 204)
})
