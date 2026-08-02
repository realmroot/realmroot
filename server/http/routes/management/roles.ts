import { forbidden } from '@server/domain/errors'
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
  roleResponseSchema,
  updateRoleRequestSchema,
} from '@shared/api/authorization'
import { Hono } from 'hono'
import { representationWithEtag, requireMatchingIfMatch } from '../../conditional'
import { getManagementAccessScope } from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementRolesRoute = new Hono()

managementRolesRoute.get('/', async (c) => c.json(await listRoles(getDeps(c), readQuery(c, paginationQuerySchema))))

managementRolesRoute.post('/', async (c) => {
  const role = roleResponseSchema.parse(await createRole(getDeps(c), await readJson(c, createRoleRequestSchema)))
  c.header('Location', `/api/roles/${encodeURIComponent(role.id)}`)
  return c.json(role, 201)
})

managementRolesRoute.get('/:roleId', async (c) => {
  await requireRoleReadAccess(c, c.req.param('roleId'))
  return c.json(await getRole(getDeps(c), c.req.param('roleId')))
})

managementRolesRoute.patch('/:roleId', async (c) =>
  c.json(await updateRole(getDeps(c), c.req.param('roleId'), await readJson(c, updateRoleRequestSchema))),
)

managementRolesRoute.delete('/:roleId', async (c) => {
  await deleteRole(getDeps(c), c.req.param('roleId'))
  return c.body(null, 204)
})

managementRolesRoute.get('/:roleId/permissions', async (c) => {
  await requireRoleReadAccess(c, c.req.param('roleId'))
  const current = await rolePermissions(getDeps(c), c.req.param('roleId'))
  c.header('ETag', current.etag)
  return c.json(current.representation)
})

async function requireRoleReadAccess(c: Parameters<typeof getManagementAccessScope>[0], roleId: string) {
  const access = getManagementAccessScope(c)
  if (access?.kind !== 'account') return
  const page = await getDeps(c).authorization.listRoleAssignments({
    roleId,
    subjectType: 'user',
    subjectId: access.userId,
    status: 'active',
    limit: 1,
    offset: 0,
    organizationIds: access.organizationIds,
    includeRealmAssignments: true,
  })
  if (page.items.length === 0) throw forbidden()
}

managementRolesRoute.put('/:roleId/permissions', async (c) => {
  const expected = c.req.header('If-Match')
  const current = await rolePermissions(getDeps(c), c.req.param('roleId'))
  requireMatchingIfMatch(expected, current.etag, 'Role permissions')
  const body = await readJson(c, replaceRolePermissionsRequestSchema)
  await replaceRolePermissions(getDeps(c), c.req.param('roleId'), body.permissions)
  const updated = await rolePermissions(getDeps(c), c.req.param('roleId'))
  c.header('ETag', updated.etag)
  return c.json(updated.representation)
})

async function rolePermissions(deps: Parameters<typeof listRolePermissions>[0], roleId: string) {
  return representationWithEtag(await listRolePermissions(deps, roleId))
}
