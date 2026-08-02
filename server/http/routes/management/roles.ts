import {
  createRole,
  deleteRole,
  getRole,
  listRolePermissions,
  listRoles,
  replaceRolePermissions,
  updateRole,
} from '@server/usecases/authorization'
import {
  createRoleRequestSchema,
  paginationQuerySchema,
  replaceRolePermissionsRequestSchema,
  updateRoleRequestSchema,
} from '@shared/api/authorization'
import { Hono } from 'hono'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementRolesRoute = new Hono()

managementRolesRoute.get('/', async (c) => c.json(await listRoles(getDeps(c), readQuery(c, paginationQuerySchema))))

managementRolesRoute.post('/', async (c) =>
  c.json(await createRole(getDeps(c), await readJson(c, createRoleRequestSchema)), 201),
)

managementRolesRoute.get('/:roleId', async (c) => c.json(await getRole(getDeps(c), c.req.param('roleId'))))

managementRolesRoute.patch('/:roleId', async (c) =>
  c.json(await updateRole(getDeps(c), c.req.param('roleId'), await readJson(c, updateRoleRequestSchema))),
)

managementRolesRoute.delete('/:roleId', async (c) => {
  await deleteRole(getDeps(c), c.req.param('roleId'))
  return c.body(null, 204)
})

managementRolesRoute.get('/:roleId/permissions', async (c) =>
  c.json(await listRolePermissions(getDeps(c), c.req.param('roleId'))),
)

managementRolesRoute.put('/:roleId/permissions', async (c) => {
  const body = await readJson(c, replaceRolePermissionsRequestSchema)
  await replaceRolePermissions(getDeps(c), c.req.param('roleId'), body.permissions)
  return c.body(null, 204)
})
