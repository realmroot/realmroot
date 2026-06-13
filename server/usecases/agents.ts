import { badRequest } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import type { AgentRepository } from '@server/usecases/ports'
import type { AccountAgent, AccountAgentsResponse } from '@shared/api/agents'
import { type PaginationInput, paginationMetadata, paginationQuerySchema } from '@shared/api/pagination'

/**
 * Minimal mirror of better-auth's AgentSession, capturing only the fields this
 * usecase reads. Keeps the usecase free of the @better-auth/agent-auth import.
 */
interface AgentSession {
  user: { id: string }
}

export async function executeReadOnlyCapability(
  deps: Deps,
  input: {
    capability: string
    arguments?: Record<string, unknown>
    agentSession: AgentSession
  },
) {
  const userId = input.agentSession.user.id

  if (input.capability === 'account.profile.read') {
    return { user: await deps.users.getUser(userId) }
  }

  if (input.capability === 'account.sessions.list') {
    const page = await deps.users.listSessions(userId, readPagination(input.arguments))
    return { sessions: page.items, pagination: paginationMetadata(page) }
  }

  if (input.capability === 'account.authorized_apps.list') {
    const page = await deps.users.listConsentedApplications(userId, readPagination(input.arguments))
    return { applications: page.items, pagination: paginationMetadata(page) }
  }

  throw badRequest(`Unsupported agent capability: ${input.capability}.`)
}

export function listAgentHosts(deps: Deps, page: PaginationInput) {
  return deps.agents.listHosts(page)
}

export function listAgents(deps: Deps, page: PaginationInput) {
  return deps.agents.listAgents(page)
}

export function listAgentCapabilityGrants(deps: Deps, page: PaginationInput) {
  return deps.agents.listCapabilityGrants(page)
}

export function listAgentApprovalRequests(deps: Deps, page: PaginationInput) {
  return deps.agents.listApprovalRequests(page)
}

export async function listAccountAgents(
  deps: Deps,
  userId: string,
  page: PaginationInput,
): Promise<AccountAgentsResponse> {
  const agents = await deps.agents.listAgentsForUser(userId, page)
  const [hosts, grants] = await Promise.all([
    deps.agents.listHostsForAgents([...new Set(agents.items.map((agent) => agent.hostId))]),
    deps.agents.listCapabilityGrantsForUser(userId),
  ])
  return {
    agents: agents.items.map((agent) => ({
      id: agent.id,
      name: agent.name,
      hostId: agent.hostId,
      host: hostSummary(hosts.find((host) => host.id === agent.hostId)!),
      status: agent.status,
      mode: agent.mode,
      lastUsedAt: agent.lastUsedAt,
      activatedAt: agent.activatedAt,
      expiresAt: agent.expiresAt,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      capabilityGrants: grants
        .filter((grant) => grant.agentId === agent.id)
        .map((grant) => ({
          id: grant.id,
          agentId: grant.agentId,
          capability: grant.capability,
          status: grant.status,
          expiresAt: grant.expiresAt,
          createdAt: grant.createdAt,
          updatedAt: grant.updatedAt,
        })),
    })) satisfies AccountAgent[],
    pagination: paginationMetadata(agents),
  }
}

export function revokeAccountAgent(deps: Deps, agentId: string, userId: string) {
  return deps.agents.revokeAgentForUser(agentId, userId)
}

export function revokeAccountCapabilityGrant(deps: Deps, grantId: string, userId: string) {
  return deps.agents.revokeCapabilityGrantForUser(grantId, userId)
}

export function revokeAgent(deps: Deps, agentId: string) {
  return deps.agents.revokeAgent(agentId)
}

export function revokeAgentHost(deps: Deps, hostId: string) {
  return deps.agents.revokeHost(hostId)
}

export function revokeAgentCapabilityGrant(deps: Deps, grantId: string) {
  return deps.agents.revokeCapabilityGrant(grantId)
}

function hostSummary(host: Awaited<ReturnType<AgentRepository['listHostsForAgents']>>[number]) {
  return {
    id: host.id,
    name: host.name,
    status: host.status,
  }
}

function readPagination(value: Record<string, unknown> | undefined) {
  return paginationQuerySchema.parse(value ?? {})
}
