import { forbidden } from '@server/domain/errors'
import { getAgent, listManagementAgentAccessGrants, toAgent } from '@server/usecases/agent-identities'
import { getRole, listRolePermissions } from '@server/usecases/authorization'
import type { Deps } from '@server/usecases/deps'
import { type PaginationInput, paginationMetadata } from '@shared/api/pagination'

async function requireOrganizationMembership(deps: Deps, organizationId: string, userId: string) {
  const member = await deps.authorization.findMemberByOrganizationUser(organizationId, userId)
  if (!member) throw forbidden('Organization membership is required.')
  return member
}

export async function listAccountRoleAssignments(deps: Deps, userId: string, page: PaginationInput) {
  const result = await deps.authorization.listRoleAssignments({
    ...page,
    context: 'realm',
    subjectType: 'user',
    subjectId: userId,
  })
  return roleAssignmentDetails(deps, result)
}

export async function listAccountOrganizationAgents(
  deps: Deps,
  organizationId: string,
  userId: string,
  page: PaginationInput,
) {
  await requireOrganizationMembership(deps, organizationId, userId)
  const agents = (await deps.agentIdentities.listOrganization(organizationId)).map(toAgent)
  return {
    items: agents.slice(page.offset, page.offset + page.limit),
    pagination: paginationMetadata({ ...page, total: agents.length }),
  }
}

export async function listAccountOrganizationRoleAssignments(
  deps: Deps,
  organizationId: string,
  userId: string,
  page: PaginationInput,
) {
  await requireOrganizationMembership(deps, organizationId, userId)
  const result = await deps.authorization.listRoleAssignments({
    ...page,
    contextualOrganizationId: organizationId,
    subjectType: 'user',
    subjectId: userId,
    status: 'active',
  })
  return roleAssignmentDetails(deps, result)
}

async function roleAssignmentDetails(
  deps: Deps,
  result: Awaited<ReturnType<Deps['authorization']['listRoleAssignments']>>,
) {
  return {
    assignments: await Promise.all(
      result.items.map(async (assignment) => {
        const [role, permissions] = await Promise.all([
          getRole(deps, assignment.roleId),
          listRolePermissions(deps, assignment.roleId),
        ])
        return { assignment, role, permissions: permissions.permissions }
      }),
    ),
    pagination: result.pagination,
  }
}

export async function listAccountOrganizationAgentAuthorizations(
  deps: Deps,
  organizationId: string,
  userId: string,
  page: PaginationInput,
) {
  await requireOrganizationMembership(deps, organizationId, userId)
  const result = await listManagementAgentAccessGrants(
    deps,
    { ...page, organizationId, status: 'active' },
    { ownerOrganizationIds: [organizationId] },
  )
  return {
    grants: await Promise.all(
      result.items.map(async (grant) => {
        const agent = await getAgent(deps, grant.agentId)
        return {
          id: grant.id,
          agentId: grant.agentId,
          agentName: agent.name,
          resourceId: grant.resource.id,
          scopes: grant.scopes,
          mode: grant.mode,
          expiresAt: grant.expiresAt,
          createdAt: grant.createdAt,
        }
      }),
    ),
    pagination: result.pagination,
  }
}
