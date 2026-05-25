import type { PaginationInput } from './pagination'

export interface AgentProtocolPage<T> {
  items: T[]
  pagination: PaginationInput & {
    total: number
    hasMore: boolean
    nextOffset: number | null
  }
}

export interface AgentProtocolHost {
  id: string
  name: string | null
  userId: string | null
  defaultCapabilities: string | null
  publicKey: string | null
  kid: string | null
  jwksUrl: string | null
  enrollmentTokenExpiresAt: Date | null
  status: string
  activatedAt: Date | null
  expiresAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface AgentProtocolAgent {
  id: string
  name: string
  userId: string | null
  hostId: string
  status: string
  mode: string
  publicKey: string
  kid: string | null
  jwksUrl: string | null
  lastUsedAt: Date | null
  activatedAt: Date | null
  expiresAt: Date | null
  metadata: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export interface AgentProtocolCapabilityGrant {
  id: string
  agentId: string
  capability: string
  deniedBy: string | null
  grantedBy: string | null
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
  status: string
  reason: string | null
  constraints: Record<string, unknown> | null
}

export interface AgentProtocolApprovalRequest {
  id: string
  method: string
  agentId: string | null
  hostId: string | null
  userId: string | null
  capabilities: string | null
  status: string
  loginHint: string | null
  bindingMessage: string | null
  clientNotificationEndpoint: string | null
  deliveryMode: string | null
  interval: number
  lastPolledAt: Date | null
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface AgentProtocolInventoryResponse {
  hosts: AgentProtocolPage<AgentProtocolHost>
  agents: AgentProtocolPage<AgentProtocolAgent>
  capabilityGrants: AgentProtocolPage<AgentProtocolCapabilityGrant>
  approvalRequests: AgentProtocolPage<AgentProtocolApprovalRequest>
}
