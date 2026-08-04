import { forbidden } from '@server/domain/errors'
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
import { getActorUserId } from '../../middleware/authn'
import {
  getConsoleOrganizationScope,
  getManagementAccessScope,
  requireConsoleOrganizationAccess,
  requireConsoleOwnedOrganization,
} from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementRoleAssignmentsRoute = new Hono()

managementRoleAssignmentsRoute.get('/', async (c) => {
  const query = readQuery(c, listRoleAssignmentsQuerySchema)
  const access = getManagementAccessScope(c)
  if (access?.kind === 'account') {
    const organizationIds = query.organizationId
      ? access.organizationIds.includes(query.organizationId)
        ? [query.organizationId]
        : []
      : access.organizationIds
    return c.json(
      listRoleAssignmentsResponseSchema.parse(
        await listRoleAssignments(
          getDeps(c),
          { ...query, subjectType: 'user', subjectId: access.userId },
          {
            organizationIds,
            includeRealmAssignments: !query.organizationId && query.context !== 'organization',
          },
        ),
      ),
    )
  }
  const organizationIds = getConsoleOrganizationScope(c)
  return c.json(
    listRoleAssignmentsResponseSchema.parse(
      await listRoleAssignments(getDeps(c), query, organizationIds ? { organizationIds } : undefined),
    ),
  )
})

managementRoleAssignmentsRoute.post('/', async (c) => {
  const body = await readJson(c, createRoleAssignmentRequestSchema)
  requireConsoleOwnedOrganization(c, body.organizationId)
  const assignment = roleAssignmentResponseSchema.parse(await createRoleAssignment(getDeps(c), body, getActorUserId(c)))
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
  c: Parameters<typeof getManagementAccessScope>[0],
  assignment: Awaited<ReturnType<typeof getRoleAssignment>>,
) {
  const access = getManagementAccessScope(c)
  if (access?.kind === 'account') {
    if (
      assignment.subjectType !== 'user' ||
      assignment.subjectId !== access.userId ||
      (assignment.organizationId !== null && !access.organizationIds.includes(assignment.organizationId))
    ) {
      throw forbidden()
    }
    return
  }
  if (assignment.organizationId) requireConsoleOrganizationAccess(c, assignment.organizationId)
  else requireConsoleOwnedOrganization(c, null)
}
