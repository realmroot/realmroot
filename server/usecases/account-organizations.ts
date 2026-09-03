import { forbidden, notFound } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import type { PaginationInput } from '@shared/api/pagination'

async function requireOrganizationMembership(deps: Deps, organizationId: string, userId: string) {
  const member = await deps.authorization.findMemberByOrganizationUser(organizationId, userId)
  if (!member) throw forbidden('Organization membership is required.')
  return member
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
