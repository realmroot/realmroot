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
  paginationQuerySchema,
  updateMemberRequestSchema,
  updateOrganizationRequestSchema,
} from '@shared/api/authorization'
import { Hono } from 'hono'
import { requireAdmin } from '../../middleware/admin'
import { getAuthContext } from '../../middleware/auth-context'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementOrganizationsRoute = new Hono()

managementOrganizationsRoute.use('*', requireAdmin())

managementOrganizationsRoute.get('/', async (c) =>
  c.json(await listOrganizations(getDeps(c), readQuery(c, paginationQuerySchema))),
)

managementOrganizationsRoute.post('/', async (c) =>
  c.json(await createOrganization(getDeps(c), await readJson(c, createOrganizationRequestSchema)), 201),
)

managementOrganizationsRoute.get('/:organizationId', async (c) =>
  c.json(await getOrganization(getDeps(c), c.req.param('organizationId'))),
)

managementOrganizationsRoute.patch('/:organizationId', async (c) =>
  c.json(
    await updateOrganization(
      getDeps(c),
      c.req.param('organizationId'),
      await readJson(c, updateOrganizationRequestSchema),
    ),
  ),
)

managementOrganizationsRoute.delete('/:organizationId', async (c) => {
  await deleteOrganization(getDeps(c), c.req.param('organizationId'))
  return c.body(null, 204)
})

managementOrganizationsRoute.get('/:organizationId/members', async (c) =>
  c.json(await listMembers(getDeps(c), c.req.param('organizationId'), readQuery(c, paginationQuerySchema))),
)

managementOrganizationsRoute.post('/:organizationId/members', async (c) =>
  c.json(await addMember(getDeps(c), c.req.param('organizationId'), await readJson(c, addMemberRequestSchema)), 201),
)

managementOrganizationsRoute.patch('/:organizationId/members/:memberId', async (c) =>
  c.json(
    await updateMember(
      getDeps(c),
      c.req.param('organizationId'),
      c.req.param('memberId'),
      await readJson(c, updateMemberRequestSchema),
    ),
  ),
)

managementOrganizationsRoute.delete('/:organizationId/members/:memberId', async (c) => {
  await removeMember(getDeps(c), c.req.param('organizationId'), c.req.param('memberId'))
  return c.body(null, 204)
})

managementOrganizationsRoute.get('/:organizationId/invitations', async (c) =>
  c.json(await listInvitations(getDeps(c), c.req.param('organizationId'), readQuery(c, paginationQuerySchema))),
)

managementOrganizationsRoute.post('/:organizationId/invitations', async (c) => {
  const { user } = getAuthContext(c)
  return c.json(
    await createInvitation(
      getDeps(c),
      c.req.param('organizationId'),
      await readJson(c, createInvitationRequestSchema),
      user?.id ?? 'system',
    ),
    201,
  )
})

managementOrganizationsRoute.delete('/:organizationId/invitations/:invitationId', async (c) => {
  await cancelInvitation(getDeps(c), c.req.param('organizationId'), c.req.param('invitationId'))
  return c.body(null, 204)
})
