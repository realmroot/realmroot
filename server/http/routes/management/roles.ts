import {
  assignAgentRole,
  assignApplicationRole,
  assignMemberRole,
  assignUserRole,
  createRole,
  deleteRole,
  getRole,
  listRoleScopes,
  listRoles,
  replaceRoleScopes,
  updateRole,
} from '@server/usecases/authorization'
import {
  assignRoleRequestSchema,
  createRoleRequestSchema,
  paginationQuerySchema,
  replaceRoleScopesRequestSchema,
  updateRoleRequestSchema,
} from '@shared/api/authorization'
import { Hono } from 'hono'
import { getActorUserId } from '../../middleware/authn'
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

managementRolesRoute.get('/:roleId/scopes', async (c) =>
  c.json(await listRoleScopes(getDeps(c), c.req.param('roleId'))),
)

managementRolesRoute.put('/:roleId/scopes', async (c) => {
  const body = await readJson(c, replaceRoleScopesRequestSchema)
  await replaceRoleScopes(getDeps(c), c.req.param('roleId'), body.scopes)
  return c.body(null, 204)
})

managementRolesRoute.post('/assignments/users', async (c) => {
  await assignUserRole(getDeps(c), await readJson(c, assignRoleRequestSchema), getActorUserId(c))
  return c.body(null, 204)
})

managementRolesRoute.post('/assignments/applications', async (c) => {
  await assignApplicationRole(getDeps(c), await readJson(c, assignRoleRequestSchema), getActorUserId(c))
  return c.body(null, 204)
})

managementRolesRoute.post('/assignments/members', async (c) => {
  await assignMemberRole(getDeps(c), await readJson(c, assignRoleRequestSchema), getActorUserId(c))
  return c.body(null, 204)
})

managementRolesRoute.post('/assignments/agents', async (c) => {
  await assignAgentRole(getDeps(c), await readJson(c, assignRoleRequestSchema), getActorUserId(c))
  return c.body(null, 204)
})
