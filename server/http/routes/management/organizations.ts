import {
  addMember,
  cancelInvitation,
  createInvitation,
  createOrganization,
  deleteOrganization,
  getOrganization,
  listInvitations,
  listMembers,
  listOrganizations,
  removeMember,
  updateMember,
  updateOrganization,
} from '@server/usecases/authorization'
import {
  addMemberRequestSchema,
  createInvitationRequestSchema,
  createOrganizationRequestSchema,
  invitationResponseSchema,
  memberResponseSchema,
  organizationResponseSchema,
  paginationQuerySchema,
  updateMemberRequestSchema,
  updateOrganizationRequestSchema,
} from '@shared/api/authorization'
import { Hono } from 'hono'
import {
  getManagementActor,
  requireManagementOrganization,
  requireRealmManagement,
  resolveManagementOrganizationIds,
} from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementOrganizationsRoute = new Hono()

managementOrganizationsRoute.get('/', async (c) =>
  c.json(await listOrganizations(getDeps(c), readQuery(c, paginationQuerySchema), resolveManagementOrganizationIds(c))),
)

managementOrganizationsRoute.post('/', async (c) => {
  requireRealmManagement(c)
  const organization = organizationResponseSchema.parse(
    await createOrganization(getDeps(c), await readJson(c, createOrganizationRequestSchema)),
  )
  c.header('Location', `/api/organizations/${encodeURIComponent(organization.id)}`)
  return c.json(organization, 201)
})

managementOrganizationsRoute.get('/:organizationId', async (c) => {
  requireManagementOrganization(c, c.req.param('organizationId'))
  return c.json(await getOrganization(getDeps(c), c.req.param('organizationId')))
})

managementOrganizationsRoute.patch('/:organizationId', async (c) => {
  requireManagementOrganization(c, c.req.param('organizationId'))
  return c.json(
    await updateOrganization(
      getDeps(c),
      c.req.param('organizationId'),
      await readJson(c, updateOrganizationRequestSchema),
    ),
  )
})

managementOrganizationsRoute.delete('/:organizationId', async (c) => {
  requireManagementOrganization(c, c.req.param('organizationId'))
  await deleteOrganization(getDeps(c), c.req.param('organizationId'))
  return c.body(null, 204)
})

managementOrganizationsRoute.get('/:organizationId/members', async (c) => {
  requireManagementOrganization(c, c.req.param('organizationId'))
  return c.json(await listMembers(getDeps(c), c.req.param('organizationId'), readQuery(c, paginationQuerySchema)))
})

managementOrganizationsRoute.post('/:organizationId/members', async (c) => {
  const organizationId = c.req.param('organizationId')
  requireManagementOrganization(c, organizationId)
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
  requireManagementOrganization(c, organizationId)
  const member = await getDeps(c).authorization.findMember(c.req.param('memberId'))
  if (!member || member.organizationId !== organizationId) return c.notFound()
  return c.json(memberResponseSchema.parse(member))
})

managementOrganizationsRoute.patch('/:organizationId/members/:memberId', async (c) => {
  requireManagementOrganization(c, c.req.param('organizationId'))
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
  requireManagementOrganization(c, c.req.param('organizationId'))
  await removeMember(getDeps(c), c.req.param('organizationId'), c.req.param('memberId'))
  return c.body(null, 204)
})

managementOrganizationsRoute.get('/:organizationId/invitations', async (c) => {
  requireManagementOrganization(c, c.req.param('organizationId'))
  return c.json(await listInvitations(getDeps(c), c.req.param('organizationId'), readQuery(c, paginationQuerySchema)))
})

managementOrganizationsRoute.post('/:organizationId/invitations', async (c) => {
  const organizationId = c.req.param('organizationId')
  requireManagementOrganization(c, organizationId)
  const invitation = invitationResponseSchema.parse(
    await createInvitation(
      getDeps(c),
      organizationId,
      await readJson(c, createInvitationRequestSchema),
      getManagementActor(c),
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
  requireManagementOrganization(c, organizationId)
  const invitation = await getDeps(c).authorization.findInvitation(c.req.param('invitationId'))
  if (!invitation || invitation.organizationId !== organizationId) return c.notFound()
  return c.json(invitationResponseSchema.parse(invitation))
})

managementOrganizationsRoute.delete('/:organizationId/invitations/:invitationId', async (c) => {
  requireManagementOrganization(c, c.req.param('organizationId'))
  await cancelInvitation(getDeps(c), c.req.param('organizationId'), c.req.param('invitationId'))
  return c.body(null, 204)
})
