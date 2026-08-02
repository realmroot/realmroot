import { forbidden } from '@server/domain/errors'
import { toAgent } from '@server/usecases/agent-identities'
import type { Deps } from '@server/usecases/deps'
import type { AccountOrganizationAuthorityResponse } from '@shared/api/account'
import { type PaginationInput, paginationMetadata } from '@shared/api/pagination'

async function requireOrganizationMembership(deps: Deps, organizationId: string, userId: string) {
  const member = await deps.authorization.findMemberByOrganizationUser(organizationId, userId)
  if (!member) throw forbidden('Organization membership is required.')
  return member
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

export async function getAccountOrganizationAuthority(
  deps: Deps,
  organizationId: string,
  userId: string,
): Promise<AccountOrganizationAuthorityResponse> {
  await requireOrganizationMembership(deps, organizationId, userId)
  const effectiveRoles = await deps.authorization.listUserRoleAssignments(userId, { organizationId })
  const roles = await Promise.all(
    effectiveRoles.map(async ({ role }) => ({
      role,
      permissions: await deps.authorization.listRolePermissions(role.id),
    })),
  )
  const agents = await deps.agentIdentities.listOrganization(organizationId)
  const agentGrants = (
    await Promise.all(
      agents.map(async (agent) => {
        const grants = await deps.externalResources.listActiveGrantsByAgent(agent.identity.id)
        return grants.map((grant) => ({
          id: grant.id,
          agentId: agent.identity.id,
          agentName: agent.identity.name,
          resourceId: grant.resourceId,
          scopes: grant.scopes,
          mode: grant.mode,
          expiresAt: grant.expiresAt?.toISOString() ?? null,
          createdAt: grant.createdAt.toISOString(),
        }))
      }),
    )
  ).flat()
  return { roles, agentGrants }
}
