import { Hono } from 'hono'
import type {
  AgentProtocolAgent,
  AgentProtocolApprovalRequest,
  AgentProtocolCapabilityGrant,
  AgentProtocolHost,
  AgentProtocolInventoryResponse,
  AgentProtocolPage,
} from '../../../../shared/api/agents'
import { type PaginatedResult, paginationMetadata, paginationQuerySchema } from '../../../../shared/api/pagination'
import { requireAdmin } from '../../../middleware/admin'
import { type AgentBindings, createAgentService } from '../../../modules/agents/context'
import type {
  AgentCapabilityGrantRecord,
  AgentHostRecord,
  AgentRecord,
  ApprovalRequestRecord,
} from '../../../modules/agents/repository'
import { readQuery } from '../../validation'

export const adminAgentsRoute = new Hono<{ Bindings: AgentBindings }>()

adminAgentsRoute.use('*', requireAdmin())

adminAgentsRoute.get('/protocol-inventory', async (c) => {
  const query = readQuery(c, paginationQuerySchema)
  const agents = createAgentService(c)
  const [hosts, agentRecords, capabilityGrants, approvalRequests] = await Promise.all([
    agents.listHosts(query),
    agents.listAgents(query),
    agents.listCapabilityGrants(query),
    agents.listApprovalRequests(query),
  ])

  return c.json({
    hosts: toProtocolPage(hosts, toHostResponse),
    agents: toProtocolPage(agentRecords, toAgentResponse),
    capabilityGrants: toProtocolPage(capabilityGrants, toCapabilityGrantResponse),
    approvalRequests: toProtocolPage(approvalRequests, toApprovalRequestResponse),
  } satisfies AgentProtocolInventoryResponse)
})

function toProtocolPage<TInput, TOutput>(
  page: PaginatedResult<TInput>,
  mapRecord: (record: TInput) => TOutput,
): AgentProtocolPage<TOutput> {
  return {
    items: page.items.map(mapRecord),
    pagination: paginationMetadata(page),
  }
}

function toHostResponse(record: AgentHostRecord): AgentProtocolHost {
  return {
    id: record.id,
    name: record.name,
    userId: record.userId,
    defaultCapabilities: record.defaultCapabilities,
    publicKey: record.publicKey,
    kid: record.kid,
    jwksUrl: record.jwksUrl,
    enrollmentTokenExpiresAt: record.enrollmentTokenExpiresAt,
    status: record.status,
    activatedAt: record.activatedAt,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function toAgentResponse(record: AgentRecord): AgentProtocolAgent {
  return {
    id: record.id,
    name: record.name,
    userId: record.userId,
    hostId: record.hostId,
    status: record.status,
    mode: record.mode,
    publicKey: record.publicKey,
    kid: record.kid,
    jwksUrl: record.jwksUrl,
    lastUsedAt: record.lastUsedAt,
    activatedAt: record.activatedAt,
    expiresAt: record.expiresAt,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function toCapabilityGrantResponse(record: AgentCapabilityGrantRecord): AgentProtocolCapabilityGrant {
  return {
    id: record.id,
    agentId: record.agentId,
    capability: record.capability,
    deniedBy: record.deniedBy,
    grantedBy: record.grantedBy,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    status: record.status,
    reason: record.reason,
    constraints: record.constraints,
  }
}

function toApprovalRequestResponse(record: ApprovalRequestRecord): AgentProtocolApprovalRequest {
  return {
    id: record.id,
    method: record.method,
    agentId: record.agentId,
    hostId: record.hostId,
    userId: record.userId,
    capabilities: record.capabilities,
    status: record.status,
    loginHint: record.loginHint,
    bindingMessage: record.bindingMessage,
    clientNotificationEndpoint: record.clientNotificationEndpoint,
    deliveryMode: record.deliveryMode,
    interval: record.interval,
    lastPolledAt: record.lastPolledAt,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
