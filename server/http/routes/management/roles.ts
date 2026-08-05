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
  replaceRoleScopesRequestSchema,
  roleResponseSchema,
  roleScopesResponseSchema,
  updateRoleRequestSchema,
} from '@shared/api/authorization'
import { Hono } from 'hono'
import { representationWithEtag, requireMatchingIfMatch } from '../../conditional'
import { requireRealmManagement } from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementRolesRoute = new Hono()

managementRolesRoute.use('*', async (c, next) => {
  requireRealmManagement(c)
  await next()
})

managementRolesRoute.get('/', async (c) => c.json(await listRoles(getDeps(c), readQuery(c, paginationQuerySchema))))

managementRolesRoute.post('/', async (c) => {
  const role = roleResponseSchema.parse(await createRole(getDeps(c), await readJson(c, createRoleRequestSchema)))
  c.header('Location', `/api/access/roles/${encodeURIComponent(role.id)}`)
  return c.json(role, 201)
})

managementRolesRoute.get('/:roleId', async (c) => {
  return c.json(await getRole(getDeps(c), c.req.param('roleId')))
})

managementRolesRoute.patch('/:roleId', async (c) =>
  c.json(await updateRole(getDeps(c), c.req.param('roleId'), await readJson(c, updateRoleRequestSchema))),
)

managementRolesRoute.delete('/:roleId', async (c) => {
  await deleteRole(getDeps(c), c.req.param('roleId'))
  return c.body(null, 204)
})

managementRolesRoute.get('/:roleId/scopes', async (c) => {
  const current = await rolePermissions(getDeps(c), c.req.param('roleId'))
  c.header('ETag', current.etag)
  return c.json(roleScopesResponseSchema.parse({ scopes: current.representation.permissions }))
})

managementRolesRoute.put('/:roleId/scopes', async (c) => {
  const expected = c.req.header('If-Match')
  const current = await rolePermissions(getDeps(c), c.req.param('roleId'))
  requireMatchingIfMatch(expected, current.etag, 'Role permissions')
  const body = await readJson(c, replaceRoleScopesRequestSchema)
  await replaceRolePermissions(getDeps(c), c.req.param('roleId'), body.scopes)
  const updated = await rolePermissions(getDeps(c), c.req.param('roleId'))
  c.header('ETag', updated.etag)
  return c.json(roleScopesResponseSchema.parse({ scopes: updated.representation.permissions }))
})

async function rolePermissions(deps: Parameters<typeof listRolePermissions>[0], roleId: string) {
  return representationWithEtag(await listRolePermissions(deps, roleId))
}
