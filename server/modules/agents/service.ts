import type { AgentSession } from '@better-auth/agent-auth'
import type { AccountAgent, AccountAgentsResponse } from '../../../shared/api/agents'
import { type PaginationInput, paginationMetadata, paginationQuerySchema } from '../../../shared/api/pagination'
import { badRequest } from '../../lib/errors'
import type { UserRepository } from '../users/repository'
import type { AgentRepository } from './repository'

export class AgentService {
  constructor(
    private readonly users: UserRepository,
    private readonly agents: AgentRepository,
  ) {}

  async executeReadOnlyCapability(input: {
    capability: string
    arguments?: Record<string, unknown>
    agentSession: AgentSession
  }) {
    const userId = input.agentSession.user.id

    if (input.capability === 'account.profile.read') {
      return { user: await this.users.getUser(userId) }
    }

    if (input.capability === 'account.sessions.list') {
      const page = await this.users.listSessions(userId, readPagination(input.arguments))
      return { sessions: page.items, pagination: paginationMetadata(page) }
    }

    if (input.capability === 'account.authorized_apps.list') {
      const page = await this.users.listConsentedApplications(userId, readPagination(input.arguments))
      return { applications: page.items, pagination: paginationMetadata(page) }
    }

    throw badRequest(`Unsupported agent capability: ${input.capability}.`)
  }

  listHosts(page: PaginationInput) {
    return this.agents.listHosts(page)
  }

  listAgents(page: PaginationInput) {
    return this.agents.listAgents(page)
  }

  listCapabilityGrants(page: PaginationInput) {
    return this.agents.listCapabilityGrants(page)
  }

  listApprovalRequests(page: PaginationInput) {
    return this.agents.listApprovalRequests(page)
  }

  async listAccountAgents(userId: string, page: PaginationInput): Promise<AccountAgentsResponse> {
    const agents = await this.agents.listAgentsForUser(userId, page)
    const [hosts, grants] = await Promise.all([
      this.agents.listHostsForAgents([...new Set(agents.items.map((agent) => agent.hostId))]),
      this.agents.listCapabilityGrantsForUser(userId),
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

  revokeAccountAgent(agentId: string, userId: string) {
    return this.agents.revokeAgentForUser(agentId, userId)
  }

  revokeAccountCapabilityGrant(grantId: string, userId: string) {
    return this.agents.revokeCapabilityGrantForUser(grantId, userId)
  }

  revokeAgent(agentId: string) {
    return this.agents.revokeAgent(agentId)
  }

  revokeHost(hostId: string) {
    return this.agents.revokeHost(hostId)
  }

  revokeCapabilityGrant(grantId: string) {
    return this.agents.revokeCapabilityGrant(grantId)
  }
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
