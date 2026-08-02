import { forbidden } from '@server/domain/errors'
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
