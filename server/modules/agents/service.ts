import type { AgentSession } from '@better-auth/agent-auth'
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
}

function readPagination(value: Record<string, unknown> | undefined) {
  return paginationQuerySchema.parse(value ?? {})
}
