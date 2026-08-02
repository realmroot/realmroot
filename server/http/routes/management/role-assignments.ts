import {
  createRoleAssignment,
  getRoleAssignment,
  listRoleAssignments,
  revokeRoleAssignment,
} from '@server/usecases/authorization'
import {
  createRoleAssignmentRequestSchema,
  listRoleAssignmentsQuerySchema,
  listRoleAssignmentsResponseSchema,
  roleAssignmentResponseSchema,
} from '@shared/api/authorization'
import { Hono } from 'hono'
import { getActorUserId } from '../../middleware/authn'
import {
  getConsoleOrganizationScope,
  requireConsoleOrganizationAccess,
  requireConsoleOwnedOrganization,
} from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementRoleAssignmentsRoute = new Hono()

managementRoleAssignmentsRoute.get('/', async (c) =>
  c.json(
    listRoleAssignmentsResponseSchema.parse(
      await listRoleAssignments(
        getDeps(c),
        readQuery(c, listRoleAssignmentsQuerySchema),
        getConsoleOrganizationScope(c) ?? undefined,
      ),
    ),
  ),
)

managementRoleAssignmentsRoute.post('/', async (c) => {
  const body = await readJson(c, createRoleAssignmentRequestSchema)
  requireConsoleOwnedOrganization(c, body.organizationId)
  return c.json(
    roleAssignmentResponseSchema.parse(await createRoleAssignment(getDeps(c), body, getActorUserId(c))),
    201,
  )
})

managementRoleAssignmentsRoute.delete('/:assignmentId', async (c) => {
  const assignment = await getRoleAssignment(getDeps(c), c.req.param('assignmentId'))
  if (assignment.organizationId) requireConsoleOrganizationAccess(c, assignment.organizationId)
  else requireConsoleOwnedOrganization(c, null)
  await revokeRoleAssignment(getDeps(c), c.req.param('assignmentId'))
  return c.body(null, 204)
})
