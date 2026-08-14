import { badRequest, forbidden } from '@server/domain/errors'
import { agentGovernanceAuditRecord } from '@server/usecases/agent-audit'
import type { Deps } from '@server/usecases/deps'
import type { AgentRepository } from '@server/usecases/ports'
import type { AccountAgent, AccountAgentsResponse } from '@shared/api/agents'
import { type PaginationInput, paginationMetadata } from '@shared/api/pagination'

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
    items: agents.items.map((agent) => ({
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

export async function getAgentApprovalPreview(
  deps: Deps,
  input: { agentId: string; userCode: string },
  userId: string,
) {
  const preview = await deps.agents.findPendingApprovalPreview({
    agentId: input.agentId,
    userCodeHash: await hashAgentUserCode(input.userCode),
    now: new Date(),
  })
  if (!preview) throw badRequest('Agent approval is invalid, expired, or no longer pending.')
  if (preview.agent.userId && preview.agent.userId !== userId) {
    throw forbidden('Agent approval belongs to another controller.')
  }
  if (preview.host.userId && preview.host.userId !== userId) {
    throw forbidden('Agent host belongs to another controller.')
  }
  return {
    agent: { id: preview.agent.id, name: preview.agent.name },
    host: { id: preview.host.id, name: preview.host.name },
  }
}

export async function decideAgentApproval(
  deps: Deps,
  input: {
    agentId: string
    userCode: string
    action: 'approve' | 'deny'
    capabilities?: string[]
  },
  userId: string,
) {
  const pendingCapabilities = (await deps.agents.listCapabilityGrantsForAgent(input.agentId))
    .filter((grant) => grant.status === 'pending')
    .map((grant) => grant.capability)
  const capabilities = input.action === 'deny' ? pendingCapabilities : (input.capabilities ?? pendingCapabilities)
  const [identity, protocolAgent] = await Promise.all([
    deps.agentIdentities.findActiveByProtocolAgent(input.agentId),
    deps.agentIdentities.findProtocolAgent(input.agentId),
  ])
  const tenant = identity
    ? identity.identity.ownerUserId !== null
      ? { type: 'user' as const, id: identity.identity.ownerUserId }
      : { type: 'organization' as const, id: identity.identity.ownerOrganizationId! }
    : protocolAgent?.userId
      ? { type: 'user' as const, id: protocolAgent.userId }
      : { type: 'user' as const, id: userId }
  const status = await deps.agents.decideApproval(
    {
      agentId: input.agentId,
      userCodeHash: await hashAgentUserCode(input.userCode),
      action: input.action,
      capabilities: input.capabilities,
      userId,
      now: new Date(),
    },
    agentGovernanceAuditRecord(deps.ids.generate(), {
      action: capabilities.length > 0 ? 'agent.capability_decided' : 'agent.enrollment_decided',
      result: input.action === 'approve' ? 'allowed' : 'denied',
      tenant,
      controllerUserId: userId,
      issuer: identity?.identity.issuer,
      subject: identity?.identity.subject,
      agentIdentityId: identity?.identity.id,
      hostId: protocolAgent?.hostId,
      capabilities,
    }),
  )
  return {
    status,
  }
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

async function hashAgentUserCode(userCode: string) {
  const stripped = userCode.replaceAll(/[^A-Z0-9]/gi, '').toUpperCase()
  const normalized = stripped.length === 8 ? `${stripped.slice(0, 4)}-${stripped.slice(4)}` : userCode.toUpperCase()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function hostSummary(host: Awaited<ReturnType<AgentRepository['listHostsForAgents']>>[number]) {
  return {
    id: host.id,
    name: host.name,
    status: host.status,
  }
}
