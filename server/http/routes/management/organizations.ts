import type { AuthorizationBindings } from '@server/modules/authorization/context'
import { createAuthorizationService } from '@server/modules/authorization/context'
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
import { readJson, readQuery } from '../validation'

export const managementOrganizationsRoute = new Hono<{ Bindings: AuthorizationBindings }>()

managementOrganizationsRoute.use('*', requireAdmin())

managementOrganizationsRoute.get('/', async (c) =>
  c.json(await createAuthorizationService(c).listOrganizations(readQuery(c, paginationQuerySchema))),
)

managementOrganizationsRoute.post('/', async (c) =>
  c.json(
    await createAuthorizationService(c).createOrganization(await readJson(c, createOrganizationRequestSchema)),
    201,
  ),
)

managementOrganizationsRoute.get('/:organizationId', async (c) =>
  c.json(await createAuthorizationService(c).getOrganization(c.req.param('organizationId'))),
)

managementOrganizationsRoute.patch('/:organizationId', async (c) =>
  c.json(
    await createAuthorizationService(c).updateOrganization(
      c.req.param('organizationId'),
      await readJson(c, updateOrganizationRequestSchema),
    ),
  ),
)

managementOrganizationsRoute.delete('/:organizationId', async (c) => {
  await createAuthorizationService(c).deleteOrganization(c.req.param('organizationId'))
  return c.body(null, 204)
})

managementOrganizationsRoute.get('/:organizationId/members', async (c) =>
  c.json(
    await createAuthorizationService(c).listMembers(c.req.param('organizationId'), readQuery(c, paginationQuerySchema)),
  ),
)

managementOrganizationsRoute.post('/:organizationId/members', async (c) =>
  c.json(
    await createAuthorizationService(c).addMember(
      c.req.param('organizationId'),
      await readJson(c, addMemberRequestSchema),
    ),
    201,
  ),
)

managementOrganizationsRoute.patch('/:organizationId/members/:memberId', async (c) =>
  c.json(
    await createAuthorizationService(c).updateMember(
      c.req.param('organizationId'),
      c.req.param('memberId'),
      await readJson(c, updateMemberRequestSchema),
    ),
  ),
)

managementOrganizationsRoute.delete('/:organizationId/members/:memberId', async (c) => {
  await createAuthorizationService(c).removeMember(c.req.param('organizationId'), c.req.param('memberId'))
  return c.body(null, 204)
})

managementOrganizationsRoute.get('/:organizationId/invitations', async (c) =>
  c.json(
    await createAuthorizationService(c).listInvitations(
      c.req.param('organizationId'),
      readQuery(c, paginationQuerySchema),
    ),
  ),
)

managementOrganizationsRoute.post('/:organizationId/invitations', async (c) => {
  const { user } = getAuthContext(c)
  return c.json(
    await createAuthorizationService(c).createInvitation(
      c.req.param('organizationId'),
      await readJson(c, createInvitationRequestSchema),
      user?.id ?? 'system',
    ),
    201,
  )
})

managementOrganizationsRoute.delete('/:organizationId/invitations/:invitationId', async (c) => {
  await createAuthorizationService(c).cancelInvitation(c.req.param('organizationId'), c.req.param('invitationId'))
  return c.body(null, 204)
})
