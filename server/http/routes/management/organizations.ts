import { forbidden } from '@server/domain/errors'
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
import { Hono } from 'hono'
import { getActorUserId, getMutationActor } from '../../middleware/authn'
import { authorizedOrganizationIds, authorizeOrganization, authorizePlatformOrganization } from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementOrganizationsRoute = new Hono()

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
  await authorizePlatformOrganization(c, 'organizations:write')
  const ownerUserId = getActorUserId(c)
  if (!ownerUserId) throw forbidden('Only authenticated users can create Organizations.')
  const organization = organizationResponseSchema.parse(
    await createOrganization(getDeps(c), await readJson(c, createOrganizationRequestSchema), ownerUserId),
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
  const member = memberResponseSchema.parse(
    await addMember(getDeps(c), organizationId, await readJson(c, addMemberRequestSchema)),
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
  await removeMember(getDeps(c), c.req.param('organizationId'), c.req.param('memberId'), getMutationActor(c))
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
  return c.json(
    memberRolesResponseSchema.parse(
      await replaceMemberRoles(
        getDeps(c),
        c.req.param('organizationId'),
        c.req.param('memberId'),
        await readJson(c, replaceMemberRolesRequestSchema),
        getMutationActor(c),
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
  const organizationId = c.req.param('organizationId')
  const role = roleResponseSchema.parse(
    await createRole(getDeps(c), organizationId, await readJson(c, createRoleRequestSchema), getMutationActor(c)),
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
  return c.json(
    roleResponseSchema.parse(
      await updateRole(
        getDeps(c),
        c.req.param('organizationId'),
        c.req.param('roleKey'),
        await readJson(c, updateRoleRequestSchema),
        getMutationActor(c),
      ),
    ),
  )
})

managementOrganizationsRoute.delete('/:organizationId/roles/:roleKey', async (c) => {
  await authorizeOrganization(c, c.req.param('organizationId'), 'roles:write')
  await deleteRole(getDeps(c), c.req.param('organizationId'), c.req.param('roleKey'), getMutationActor(c))
  return c.body(null, 204)
})

managementOrganizationsRoute.get('/:organizationId/invitations', async (c) => {
  await authorizeOrganization(c, c.req.param('organizationId'), 'users:read')
  return c.json(await listInvitations(getDeps(c), c.req.param('organizationId'), readQuery(c, paginationQuerySchema)))
})

managementOrganizationsRoute.post('/:organizationId/invitations', async (c) => {
  const organizationId = c.req.param('organizationId')
  await authorizeOrganization(c, organizationId, 'role-assignments:write')
  const invitation = invitationResponseSchema.parse(
    await createInvitation(
      getDeps(c),
      organizationId,
      await readJson(c, createInvitationRequestSchema),
      getMutationActor(c),
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
