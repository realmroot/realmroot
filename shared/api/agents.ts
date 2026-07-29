import { z } from 'zod'
import { type PaginationInput, paginationMetadataSchema } from './pagination'

const dateValueSchema = z.union([z.string(), z.date()])

export const agentIdentityStatusSchema = z.enum(['active', 'recovering', 'retired'])
export const agentIdentityBindingStatusSchema = z.enum(['active', 'revoked'])
export const agentEnrollmentIntentStatusSchema = z.enum(['pending', 'approved', 'expired', 'cancelled'])

export const agentHomeSpaceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('personal'), userId: z.string() }),
  z.object({ type: z.literal('organization'), organizationId: z.string() }),
])

export const agentIdentityBindingSchema = z.object({
  id: z.string(),
  protocolAgentId: z.string(),
  hostId: z.string(),
  status: agentIdentityBindingStatusSchema,
  boundAt: dateValueSchema,
  revokedAt: dateValueSchema.nullable(),
})

export const agentIdentitySchema = z.object({
  id: z.string(),
  issuer: z.url(),
  subject: z.string(),
  name: z.string(),
  homeSpace: agentHomeSpaceSchema,
  status: agentIdentityStatusSchema,
  retiredAt: dateValueSchema.nullable(),
  createdAt: dateValueSchema,
  updatedAt: dateValueSchema,
  bindings: z.array(agentIdentityBindingSchema),
})

export const listAgentIdentitiesResponseSchema = z.object({
  identities: z.array(agentIdentitySchema),
})

export const createAgentEnrollmentIntentRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  protocolAgentId: z.string().trim().min(1),
  organizationId: z.string().trim().min(1).optional(),
})

export const createAdditionalAgentEnrollmentIntentRequestSchema = z.object({
  protocolAgentId: z.string().trim().min(1),
})

export const createAgentProtocolEnrollmentIntentRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  organizationId: z.string().trim().min(1).optional(),
})

export const createAgentLoginIdentityRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
})

export const agentEnrollmentIntentSchema = z.object({
  id: z.string(),
  agentIdentityId: z.string().nullable(),
  requestedName: z.string().nullable(),
  homeSpace: agentHomeSpaceSchema,
  protocolAgentId: z.string(),
  status: agentEnrollmentIntentStatusSchema,
  expiresAt: dateValueSchema,
  approvedAt: dateValueSchema.nullable(),
  createdAt: dateValueSchema,
  updatedAt: dateValueSchema,
})

export const agentProtocolEnrollmentIntentResponseSchema = z.object({
  intent: agentEnrollmentIntentSchema,
  verification_uri: z.url(),
  verification_uri_complete: z.url(),
})

export const agentProtocolIdentityResponseSchema = z.object({
  identity: agentIdentitySchema,
})

export const requestAgentCapabilitiesSchema = z.object({
  capabilities: z.array(z.enum(['management:read', 'management:write'])).min(1),
  reason: z.string().trim().min(1).max(500).optional(),
})

const agentCapabilityGrantSummarySchema = z.object({
  capability: z.string(),
  status: z.string(),
  description: z.string().optional(),
})

const agentCapabilityApprovalSchema = z.object({
  method: z.string(),
  device_code: z.string().optional(),
  verification_uri: z.url().optional(),
  verification_uri_complete: z.url().optional(),
  user_code: z.string().optional(),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive(),
})

export const requestAgentCapabilitiesResponseSchema = z.object({
  agent_id: z.string(),
  status: z.enum(['active', 'pending']),
  agent_capability_grants: z.array(agentCapabilityGrantSummarySchema),
  approval: agentCapabilityApprovalSchema.optional(),
})

export const decideAgentApprovalRequestSchema = z.object({
  userCode: z.string().trim().min(1),
  action: z.enum(['approve', 'deny']),
  capabilities: z.array(z.string().trim().min(1)).optional(),
})

export const decideAgentApprovalResponseSchema = z.object({
  status: z.enum(['approved', 'denied']),
})

export const approveAgentEnrollmentResponseSchema = z.object({
  identity: agentIdentitySchema,
})

export const createAgentAuthorityGrantRequestSchema = z.object({
  mode: z.enum(['autonomous', 'delegated']),
  audience: z.url(),
  scopes: z.array(z.string().trim().min(1)).min(1),
  constraints: z
    .object({
      allowedHostIds: z.array(z.string().min(1)).min(1).optional(),
      notBefore: z.iso.datetime().optional(),
      maxUses: z.number().int().positive().optional(),
      stepUpRequired: z.boolean().optional(),
    })
    .optional(),
  expiresAt: z.iso.datetime().optional(),
})

export const agentAuthorityGrantSchema = z.object({
  id: z.string(),
  agentIdentityId: z.string(),
  mode: z.enum(['autonomous', 'delegated']),
  subjectType: z.enum(['agent', 'user', 'organization']),
  subjectId: z.string(),
  audience: z.string(),
  scopes: z.array(z.string()),
  constraints: z.record(z.string(), z.unknown()).nullable(),
  status: z.enum(['active', 'revoked']),
  expiresAt: dateValueSchema.nullable(),
  revokedAt: dateValueSchema.nullable(),
  createdAt: dateValueSchema,
  updatedAt: dateValueSchema,
})

export const agentTokenRequestSchema = z.object({
  grantId: z.string().trim().min(1),
  scope: z.string().trim().optional(),
  approvalId: z.string().trim().min(1).optional(),
})

export const agentAuthorityGrantType = 'urn:flareauth:params:oauth:grant-type:agent-authority'

export const agentTokenFormSchema = z.object({
  grant_type: z.literal(agentAuthorityGrantType),
  grant_id: z.string().trim().min(1),
  scope: z.string().trim().optional(),
  approval_id: z.string().trim().min(1).optional(),
})

export const agentAuthorityApprovalSchema = z.object({
  id: z.string(),
  grantId: z.string(),
  bindingId: z.string(),
  requestedScopes: z.array(z.string()),
  status: z.enum(['pending', 'approved', 'consumed']),
  expiresAt: dateValueSchema,
  approvedAt: dateValueSchema.nullable(),
  consumedAt: dateValueSchema.nullable(),
  createdAt: dateValueSchema,
  updatedAt: dateValueSchema,
})

export const agentAuditEventSchema = z.object({
  id: z.string(),
  action: z.string(),
  result: z.enum(['allowed', 'denied']),
  controllerUserId: z.string().nullable(),
  subjectIssuer: z.string().nullable(),
  subject: z.string().nullable(),
  agentIdentityId: z.string().nullable(),
  hostId: z.string().nullable(),
  authorityGrantId: z.string().nullable(),
  externalAccountId: z.string().nullable(),
  externalAccountGrantId: z.string().nullable(),
  targetOrigin: z.string().nullable(),
  targetPath: z.string().nullable(),
  method: z.string().nullable(),
  reasonCode: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  occurredAt: dateValueSchema,
})

export const listAgentIdentityInventoryResponseSchema = z.object({
  identities: z.array(agentIdentitySchema),
  pagination: paginationMetadataSchema,
})

export const listAgentAuditEventsResponseSchema = z.object({
  events: z.array(agentAuditEventSchema),
  pagination: paginationMetadataSchema,
})

export const agentTokenResponseSchema = z.object({
  access_token: z.string(),
  issued_token_type: z.literal('urn:ietf:params:oauth:token-type:access_token'),
  token_type: z.literal('DPoP'),
  expires_in: z.number().int().positive(),
  scope: z.string(),
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

export type AgentIdentityStatus = z.infer<typeof agentIdentityStatusSchema>
export type AgentHomeSpace = z.infer<typeof agentHomeSpaceSchema>
export type AgentIdentity = z.infer<typeof agentIdentitySchema>
export type AgentAuditEvent = z.infer<typeof agentAuditEventSchema>
export type AgentEnrollmentIntent = z.infer<typeof agentEnrollmentIntentSchema>
export type CreateAgentEnrollmentIntentRequest = z.infer<typeof createAgentEnrollmentIntentRequestSchema>
export type CreateAgentProtocolEnrollmentIntentRequest = z.infer<
  typeof createAgentProtocolEnrollmentIntentRequestSchema
>
export type CreateAdditionalAgentEnrollmentIntentRequest = z.infer<
  typeof createAdditionalAgentEnrollmentIntentRequestSchema
>
export type CreateAgentAuthorityGrantRequest = z.infer<typeof createAgentAuthorityGrantRequestSchema>
export type AgentAuthorityGrant = z.infer<typeof agentAuthorityGrantSchema>
export type AgentTokenRequest = z.infer<typeof agentTokenRequestSchema>

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
