import { forbidden, notFound } from '@server/domain/errors'
import { platformOrganization } from '@server/domain/platform-organization'
import {
  addMember,
  cancelInvitation,
  createInvitation,
  createOrganization,
  createRole,
  deleteOrganization,
  deleteRole,
  getOrganization,
  getRole,
  listInvitations,
  listMembers,
  listOrganizations,
  listRoles,
  removeMember,
  replaceMemberRoles,
  updateMember,
  updateOrganization,
  updateRole,
} from '@server/usecases/authorization'
import {
  addMemberRequestSchema,
  createInvitationRequestSchema,
  createOrganizationRequestSchema,
  createRoleRequestSchema,
  invitationResponseSchema,
  memberResponseSchema,
  memberRolesResponseSchema,
  organizationResponseSchema,
  paginationQuerySchema,
  replaceMemberRolesRequestSchema,
  roleResponseSchema,
  updateMemberRequestSchema,
  updateOrganizationRequestSchema,
  updateRoleRequestSchema,
} from '@shared/api/authorization'
import { Hono, type MiddlewareHandler } from 'hono'
import { getActorUserId } from '../../middleware/authn'
import {
  authorizedOrganizationIds,
  authorizeOrganization,
  hasPlatformAccess,
  requirePlatformAccess,
} from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementOrganizationsRoute = new Hono()

const rejectRealmSentinel: MiddlewareHandler = async (c, next) => {
  if (c.req.param('organizationId') === platformOrganization.id) throw notFound('Organization was not found.')
  await next()
}

managementOrganizationsRoute.use('/:organizationId', rejectRealmSentinel)
managementOrganizationsRoute.use('/:organizationId/*', rejectRealmSentinel)

managementOrganizationsRoute.get('/', async (c) =>
  c.json(
    await listOrganizations(
      getDeps(c),
      readQuery(c, paginationQuerySchema),
      await authorizedOrganizationIds(c, 'organizations:read'),
    ),
  ),
)

managementOrganizationsRoute.post('/', async (c) => {
  requirePlatformAccess(c, 'organizations:write')
  const organization = organizationResponseSchema.parse(
    await createOrganization(getDeps(c), await readJson(c, createOrganizationRequestSchema)),
  )
  c.header('Location', `/api/organizations/${encodeURIComponent(organization.id)}`)
  return c.json(organization, 201)
})

managementOrganizationsRoute.get('/:organizationId', async (c) => {
  await authorizeOrganization(c, c.req.param('organizationId'), 'organizations:read')
  return c.json(await getOrganization(getDeps(c), c.req.param('organizationId')))
})

managementOrganizationsRoute.patch('/:organizationId', async (c) => {
  await authorizeOrganization(c, c.req.param('organizationId'), 'organizations:write')
  return c.json(
    await updateOrganization(
      getDeps(c),
      c.req.param('organizationId'),
      await readJson(c, updateOrganizationRequestSchema),
    ),
  )
})

managementOrganizationsRoute.delete('/:organizationId', async (c) => {
  await authorizeOrganization(c, c.req.param('organizationId'), 'organizations:delete')
  await deleteOrganization(getDeps(c), c.req.param('organizationId'))
  return c.body(null, 204)
})

managementOrganizationsRoute.get('/:organizationId/members', async (c) => {
  await authorizeOrganization(c, c.req.param('organizationId'), 'users:read')
  return c.json(await listMembers(getDeps(c), c.req.param('organizationId'), readQuery(c, paginationQuerySchema)))
})

managementOrganizationsRoute.post('/:organizationId/members', async (c) => {
  const organizationId = c.req.param('organizationId')
  await authorizeOrganization(c, organizationId, 'role-assignments:write')
  const actorUserId = getActorUserId(c)
  if (!actorUserId) throw forbidden('Only Organization users can assign Roles.')
  const member = memberResponseSchema.parse(
    await addMember(
      getDeps(c),
      organizationId,
      await readJson(c, addMemberRequestSchema),
      actorUserId,
      hasPlatformAccess(c, 'organizations:write'),
    ),
  )
  c.header(
    'Location',
    `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(member.id)}`,
  )
  return c.json(member, 201)
})

managementOrganizationsRoute.get('/:organizationId/members/:memberId', async (c) => {
  const organizationId = c.req.param('organizationId')
  await authorizeOrganization(c, organizationId, 'users:read')
  const member = await getDeps(c).authorization.findMember(c.req.param('memberId'))
  if (!member || member.organizationId !== organizationId) return c.notFound()
  return c.json(memberResponseSchema.parse(member))
})

managementOrganizationsRoute.patch('/:organizationId/members/:memberId', async (c) => {
  await authorizeOrganization(c, c.req.param('organizationId'), 'role-assignments:write')
  return c.json(
    await updateMember(
      getDeps(c),
      c.req.param('organizationId'),
      c.req.param('memberId'),
      await readJson(c, updateMemberRequestSchema),
    ),
  )
})

managementOrganizationsRoute.delete('/:organizationId/members/:memberId', async (c) => {
  await authorizeOrganization(c, c.req.param('organizationId'), 'role-assignments:write')
  const actorUserId = getActorUserId(c)
  if (!actorUserId) throw forbidden('Only Organization users can remove members.')
  await removeMember(getDeps(c), c.req.param('organizationId'), c.req.param('memberId'), actorUserId)
  return c.body(null, 204)
})

managementOrganizationsRoute.get('/:organizationId/members/:memberId/roles', async (c) => {
  const organizationId = c.req.param('organizationId')
  await authorizeOrganization(c, organizationId, 'role-assignments:read')
  const member = await getDeps(c).authorization.findMember(c.req.param('memberId'))
  if (!member || member.organizationId !== organizationId) return c.notFound()
  return c.json(memberRolesResponseSchema.parse({ roles: member.roles }))
})

managementOrganizationsRoute.put('/:organizationId/members/:memberId/roles', async (c) => {
  await authorizeOrganization(c, c.req.param('organizationId'), 'role-assignments:write')
  const actorUserId = getActorUserId(c)
  if (!actorUserId) throw forbidden('Only Organization users can assign Roles.')
  return c.json(
    memberRolesResponseSchema.parse(
      await replaceMemberRoles(
        getDeps(c),
        c.req.param('organizationId'),
        c.req.param('memberId'),
        await readJson(c, replaceMemberRolesRequestSchema),
        actorUserId,
        hasPlatformAccess(c, 'role-assignments:write'),
      ),
    ),
  )
})

managementOrganizationsRoute.get('/:organizationId/roles', async (c) => {
  await authorizeOrganization(c, c.req.param('organizationId'), 'roles:read')
  return c.json(await listRoles(getDeps(c), c.req.param('organizationId'), readQuery(c, paginationQuerySchema)))
})

managementOrganizationsRoute.post('/:organizationId/roles', async (c) => {
  await authorizeOrganization(c, c.req.param('organizationId'), 'roles:write')
  const actorUserId = getActorUserId(c)
  if (!actorUserId) throw forbidden('Only Organization users can define Roles.')
  const organizationId = c.req.param('organizationId')
  const role = roleResponseSchema.parse(
    await createRole(getDeps(c), organizationId, await readJson(c, createRoleRequestSchema), actorUserId),
  )
  c.header('Location', `/api/organizations/${encodeURIComponent(organizationId)}/roles/${encodeURIComponent(role.key)}`)
  return c.json(role, 201)
})

managementOrganizationsRoute.get('/:organizationId/roles/:roleKey', async (c) => {
  await authorizeOrganization(c, c.req.param('organizationId'), 'roles:read')
  return c.json(
    roleResponseSchema.parse(await getRole(getDeps(c), c.req.param('organizationId'), c.req.param('roleKey'))),
  )
})

managementOrganizationsRoute.patch('/:organizationId/roles/:roleKey', async (c) => {
  await authorizeOrganization(c, c.req.param('organizationId'), 'roles:write')
  const actorUserId = getActorUserId(c)
  if (!actorUserId) throw forbidden('Only Organization users can define Roles.')
  return c.json(
    roleResponseSchema.parse(
      await updateRole(
        getDeps(c),
        c.req.param('organizationId'),
        c.req.param('roleKey'),
        await readJson(c, updateRoleRequestSchema),
        actorUserId,
      ),
    ),
  )
})

managementOrganizationsRoute.delete('/:organizationId/roles/:roleKey', async (c) => {
  await authorizeOrganization(c, c.req.param('organizationId'), 'roles:write')
  const actorUserId = getActorUserId(c)
  if (!actorUserId) throw forbidden('Only Organization users can define Roles.')
  await deleteRole(getDeps(c), c.req.param('organizationId'), c.req.param('roleKey'), actorUserId)
  return c.body(null, 204)
})

managementOrganizationsRoute.get('/:organizationId/invitations', async (c) => {
  await authorizeOrganization(c, c.req.param('organizationId'), 'users:read')
  return c.json(await listInvitations(getDeps(c), c.req.param('organizationId'), readQuery(c, paginationQuerySchema)))
})

managementOrganizationsRoute.post('/:organizationId/invitations', async (c) => {
  const organizationId = c.req.param('organizationId')
  await authorizeOrganization(c, organizationId, 'role-assignments:write')
  const actorUserId = getActorUserId(c)
  if (!actorUserId) throw forbidden('Only Organization users can assign Roles.')
  const invitation = invitationResponseSchema.parse(
    await createInvitation(
      getDeps(c),
      organizationId,
      await readJson(c, createInvitationRequestSchema),
      actorUserId,
      hasPlatformAccess(c, 'role-assignments:write'),
    ),
  )
  c.header(
    'Location',
    `/api/organizations/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitation.id)}`,
  )
  return c.json(invitation, 201)
})

managementOrganizationsRoute.get('/:organizationId/invitations/:invitationId', async (c) => {
  const organizationId = c.req.param('organizationId')
  await authorizeOrganization(c, organizationId, 'users:read')
  const invitation = await getDeps(c).authorization.findInvitation(c.req.param('invitationId'))
  if (!invitation || invitation.organizationId !== organizationId) return c.notFound()
  return c.json(invitationResponseSchema.parse(invitation))
})

managementOrganizationsRoute.delete('/:organizationId/invitations/:invitationId', async (c) => {
  await authorizeOrganization(c, c.req.param('organizationId'), 'role-assignments:write')
  await cancelInvitation(getDeps(c), c.req.param('organizationId'), c.req.param('invitationId'))
  return c.body(null, 204)
})
