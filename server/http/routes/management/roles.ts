import type { AuthorizationBindings } from '@server/composition'
import { createAuthorizationService } from '@server/composition'
import {
  assignRoleRequestSchema,
  createRoleRequestSchema,
  paginationQuerySchema,
  replaceRolePermissionsRequestSchema,
  updateRoleRequestSchema,
} from '@shared/api/authorization'
import { Hono } from 'hono'
import { requireAdmin } from '../../middleware/admin'
import { getAuthContext } from '../../middleware/auth-context'
import { readJson, readQuery } from '../validation'

export const managementRolesRoute = new Hono<{ Bindings: AuthorizationBindings }>()

managementRolesRoute.use('*', requireAdmin())

managementRolesRoute.get('/', async (c) =>
  c.json(await createAuthorizationService(c).listRoles(readQuery(c, paginationQuerySchema))),
)

managementRolesRoute.post('/', async (c) =>
  c.json(await createAuthorizationService(c).createRole(await readJson(c, createRoleRequestSchema)), 201),
)

managementRolesRoute.get('/:roleId', async (c) =>
  c.json(await createAuthorizationService(c).getRole(c.req.param('roleId'))),
)

managementRolesRoute.patch('/:roleId', async (c) =>
  c.json(
    await createAuthorizationService(c).updateRole(c.req.param('roleId'), await readJson(c, updateRoleRequestSchema)),
  ),
)

managementRolesRoute.delete('/:roleId', async (c) => {
  await createAuthorizationService(c).deleteRole(c.req.param('roleId'))
  return c.body(null, 204)
})

managementRolesRoute.get('/:roleId/permissions', async (c) =>
  c.json(await createAuthorizationService(c).listRolePermissions(c.req.param('roleId'))),
)

managementRolesRoute.put('/:roleId/permissions', async (c) => {
  const body = await readJson(c, replaceRolePermissionsRequestSchema)
  await createAuthorizationService(c).replaceRolePermissions(c.req.param('roleId'), body.permissionIds)
  return c.body(null, 204)
})

managementRolesRoute.post('/assignments/users', async (c) => {
  const { user } = getAuthContext(c)
  await createAuthorizationService(c).assignUserRole(await readJson(c, assignRoleRequestSchema), user!.id)
  return c.body(null, 204)
})

managementRolesRoute.post('/assignments/applications', async (c) => {
  const { user } = getAuthContext(c)
  await createAuthorizationService(c).assignApplicationRole(await readJson(c, assignRoleRequestSchema), user!.id)
  return c.body(null, 204)
})

managementRolesRoute.post('/assignments/members', async (c) => {
  const { user } = getAuthContext(c)
  await createAuthorizationService(c).assignMemberRole(await readJson(c, assignRoleRequestSchema), user!.id)
  return c.body(null, 204)
})
