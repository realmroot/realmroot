import { forbidden, notFound } from '@server/domain/errors'
import { toAgent } from '@server/usecases/agent-identities'
import type { Deps } from '@server/usecases/deps'
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

export async function listAccountOrganizationTeamMembers(
  deps: Deps,
  organizationId: string,
  teamId: string,
  userId: string,
  page: PaginationInput,
) {
  const caller = await requireOrganizationMembership(deps, organizationId, userId)
  if (!caller.roles.some((role) => role === 'owner' || role === 'admin')) {
    throw forbidden('Organization administrator access is required.')
  }

  const team = await deps.authorization.findTeam(teamId)
  if (!team || team.organizationId !== organizationId) throw notFound('Team not found.')
  return deps.authorization.listTeamMembers(teamId, page)
}
