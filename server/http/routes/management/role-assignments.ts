import {
  createRoleAssignment,
  getRoleAssignment,
  listRoleAssignments,
  putRoleAssignmentRevocation,
} from '@server/usecases/authorization'
import {
  createRoleAssignmentRequestSchema,
  listRoleAssignmentsQuerySchema,
  listRoleAssignmentsResponseSchema,
  roleAssignmentResponseSchema,
  roleAssignmentRevocationSchema,
} from '@shared/api/authorization'
import { Hono } from 'hono'
import {
  getManagementActor,
  requireManagementOwnedOrganization,
  requireRealmManagement,
  resolveManagementOrganizationIds,
} from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementRoleAssignmentsRoute = new Hono()

managementRoleAssignmentsRoute.get('/', async (c) => {
  const query = readQuery(c, listRoleAssignmentsQuerySchema)
  const organizationIds = resolveManagementOrganizationIds(c, query.organizationId)
  if (query.context === 'realm') requireRealmManagement(c)
  return c.json(
    listRoleAssignmentsResponseSchema.parse(
      await listRoleAssignments(getDeps(c), query, organizationIds ? { organizationIds } : undefined),
    ),
  )
})

managementRoleAssignmentsRoute.post('/', async (c) => {
  const body = await readJson(c, createRoleAssignmentRequestSchema)
  requireManagementOwnedOrganization(c, body.organizationId)
  const actor = getManagementActor(c)
  const assignment = roleAssignmentResponseSchema.parse(await createRoleAssignment(getDeps(c), body, actor))
  c.header('Location', `/api/access/assignments/${encodeURIComponent(assignment.id)}`)
  return c.json(assignment, 201)
})

managementRoleAssignmentsRoute.get('/:assignmentId', async (c) => {
  const assignment = await getRoleAssignment(getDeps(c), c.req.param('assignmentId'))
  requireRoleAssignmentAccess(c, assignment)
  return c.json(roleAssignmentResponseSchema.parse(assignment))
})

managementRoleAssignmentsRoute.put('/:assignmentId/revocation', async (c) => {
  const assignment = await getRoleAssignment(getDeps(c), c.req.param('assignmentId'))
  requireRoleAssignmentAccess(c, assignment)
  return c.json(
    roleAssignmentRevocationSchema.parse(await putRoleAssignmentRevocation(getDeps(c), c.req.param('assignmentId'))),
  )
})

managementRoleAssignmentsRoute.get('/:assignmentId/revocation', async (c) => {
  const assignment = await getRoleAssignment(getDeps(c), c.req.param('assignmentId'))
  requireRoleAssignmentAccess(c, assignment)
  return c.json({ roleAssignmentId: assignment.id, revokedAt: assignment.revokedAt })
})

function requireRoleAssignmentAccess(
  c: Parameters<typeof requireManagementOwnedOrganization>[0],
  assignment: Awaited<ReturnType<typeof getRoleAssignment>>,
) {
  requireManagementOwnedOrganization(c, assignment.organizationId)
}
