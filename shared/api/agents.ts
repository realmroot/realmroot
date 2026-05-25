import { z } from 'zod'
import type { PaginationInput } from './pagination'

const dateValueSchema = z.union([z.string(), z.date()])
const paginationMetadataSchema = z.object({
  limit: z.number().int(),
  offset: z.number().int(),
  total: z.number().int(),
  hasMore: z.boolean(),
  nextOffset: z.number().int().nullable(),
})

export const accountAgentGrantSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  capability: z.string(),
  status: z.string(),
  expiresAt: dateValueSchema.nullable(),
  createdAt: dateValueSchema,
  updatedAt: dateValueSchema,
})

export const accountAgentHostSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  status: z.string(),
})

export const accountAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  hostId: z.string(),
  host: accountAgentHostSchema,
  status: z.string(),
  mode: z.string(),
  lastUsedAt: dateValueSchema.nullable(),
  activatedAt: dateValueSchema.nullable(),
  expiresAt: dateValueSchema.nullable(),
  createdAt: dateValueSchema,
  updatedAt: dateValueSchema,
  capabilityGrants: z.array(accountAgentGrantSchema),
})

export const accountAgentsResponseSchema = z.object({
  agents: z.array(accountAgentSchema),
  pagination: paginationMetadataSchema,
})

const agentProtocolPageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    pagination: paginationMetadataSchema,
  })

export const agentProtocolHostSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  userId: z.string().nullable(),
  defaultCapabilities: z.string().nullable(),
  publicKey: z.string().nullable(),
  kid: z.string().nullable(),
  jwksUrl: z.string().nullable(),
  enrollmentTokenExpiresAt: dateValueSchema.nullable(),
  status: z.string(),
  activatedAt: dateValueSchema.nullable(),
  expiresAt: dateValueSchema.nullable(),
  lastUsedAt: dateValueSchema.nullable(),
  createdAt: dateValueSchema,
  updatedAt: dateValueSchema,
})

export const agentProtocolAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  userId: z.string().nullable(),
  hostId: z.string(),
  status: z.string(),
  mode: z.string(),
  publicKey: z.string(),
  kid: z.string().nullable(),
  jwksUrl: z.string().nullable(),
  lastUsedAt: dateValueSchema.nullable(),
  activatedAt: dateValueSchema.nullable(),
  expiresAt: dateValueSchema.nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: dateValueSchema,
  updatedAt: dateValueSchema,
})

export const agentProtocolCapabilityGrantSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  capability: z.string(),
  deniedBy: z.string().nullable(),
  grantedBy: z.string().nullable(),
  expiresAt: dateValueSchema.nullable(),
  createdAt: dateValueSchema,
  updatedAt: dateValueSchema,
  status: z.string(),
  reason: z.string().nullable(),
  constraints: z.record(z.string(), z.unknown()).nullable(),
})

export const agentProtocolApprovalRequestSchema = z.object({
  id: z.string(),
  method: z.string(),
  agentId: z.string().nullable(),
  hostId: z.string().nullable(),
  userId: z.string().nullable(),
  capabilities: z.string().nullable(),
  status: z.string(),
  loginHint: z.string().nullable(),
  bindingMessage: z.string().nullable(),
  clientNotificationEndpoint: z.string().nullable(),
  deliveryMode: z.string().nullable(),
  interval: z.number().int(),
  lastPolledAt: dateValueSchema.nullable(),
  expiresAt: dateValueSchema,
  createdAt: dateValueSchema,
  updatedAt: dateValueSchema,
})

export const agentProtocolInventoryResponseSchema = z.object({
  hosts: agentProtocolPageSchema(agentProtocolHostSchema),
  agents: agentProtocolPageSchema(agentProtocolAgentSchema),
  capabilityGrants: agentProtocolPageSchema(agentProtocolCapabilityGrantSchema),
  approvalRequests: agentProtocolPageSchema(agentProtocolApprovalRequestSchema),
})

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

export interface AccountAgentGrant {
  id: string
  agentId: string
  capability: string
  status: string
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface AccountAgentHost {
  id: string
  name: string | null
  status: string
}

export interface AccountAgent {
  id: string
  name: string
  hostId: string
  host: AccountAgentHost
  status: string
  mode: string
  lastUsedAt: Date | null
  activatedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
  capabilityGrants: AccountAgentGrant[]
}

export interface AccountAgentsResponse {
  agents: AccountAgent[]
  pagination: AgentProtocolPage<AccountAgent>['pagination']
}
