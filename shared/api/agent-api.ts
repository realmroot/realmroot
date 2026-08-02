import { z } from 'zod'
import { agentAuditEventSchema, agentHomeSpaceSchema, agentIdentityStatusSchema } from './agents'
import {
  apiResourceResponseSchema,
  createApiResourceRequestSchema,
  updateApiResourceRequestSchema,
} from './authorization'
import {
  agentAccessGrantModeSchema,
  agentAccessRequestStatusSchema,
  externalResourceAuthorizationSchema,
} from './external-resources'
import { paginationMetadataSchema, paginationQuerySchema } from './pagination'

const nonEmptyString = z.string().trim().min(1)
const scopeListSchema = z
  .array(nonEmptyString)
  .min(1)
  .transform((values) => [...new Set(values)].sort())

export const agentSchema = z.object({
  id: z.string(),
  issuer: z.url(),
  subject: z.string(),
  name: z.string(),
  homeSpace: agentHomeSpaceSchema,
  status: agentIdentityStatusSchema,
  retiredAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const agentResponseSchema = z.object({ agent: agentSchema })
export const managementAgentSchema = agentSchema.extend({
  owner: z.object({
    id: z.string(),
    type: z.enum(['user', 'organization']),
    displayName: z.string(),
  }),
  hostCount: z.number().int().nonnegative(),
  roleCount: z.number().int().nonnegative(),
  pendingRequestCount: z.number().int().nonnegative(),
  activeGrantCount: z.number().int().nonnegative(),
})
export const managementAgentResponseSchema = z.object({ agent: managementAgentSchema })
export const agentsResponseSchema = z.object({
  items: z.array(agentSchema),
  pagination: paginationMetadataSchema,
})
export const managementAgentsResponseSchema = z.object({
  items: z.array(managementAgentSchema),
  pagination: paginationMetadataSchema,
})
export const listAgentsQuerySchema = paginationQuerySchema.extend({
  organizationId: nonEmptyString.optional(),
})
export type ListAgentsQuery = z.infer<typeof listAgentsQuerySchema>
export const agentInfoQuerySchema = z.object({
  sub: nonEmptyString,
})
export const agentInfoSchema = z.object({
  iss: z.url(),
  sub: z.string(),
  sub_profile: z.literal('ai_agent'),
  name: z.string(),
  picture: z.url().optional(),
  updated_at: z.number().int().nonnegative(),
})
export const auditEventsResponseSchema = z.object({
  items: z.array(agentAuditEventSchema),
  pagination: paginationMetadataSchema,
})
export const listAgentAuditEventsQuerySchema = paginationQuerySchema.extend({
  organizationId: nonEmptyString.optional(),
  agentId: nonEmptyString.optional(),
})
export type ListAgentAuditEventsQuery = z.infer<typeof listAgentAuditEventsQuerySchema>

export const managementAgentHostSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  bindingStatus: z.string(),
  credentialType: z.enum(['public_key', 'remote_jwks']),
  boundAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime().nullable(),
})
export const managementAgentHostsResponseSchema = z.object({
  items: z.array(managementAgentHostSchema),
  pagination: paginationMetadataSchema,
})

export const managementAgentRoleSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
})
export const managementAgentRolesResponseSchema = z.object({
  items: z.array(managementAgentRoleSchema),
  pagination: paginationMetadataSchema,
})

const managementAgentResourceSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  name: z.string(),
})
export const managementAgentAccessRequestSchema = z.object({
  id: z.string(),
  resource: managementAgentResourceSchema,
  scopes: z.array(z.string()),
  reason: z.string().nullable(),
  status: agentAccessRequestStatusSchema,
  expiresAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})
export const managementAgentAccessRequestsResponseSchema = z.object({
  items: z.array(managementAgentAccessRequestSchema),
  pagination: paginationMetadataSchema,
})

export const managementAgentAccessGrantSchema = z.object({
  id: z.string(),
  resource: managementAgentResourceSchema,
  scopes: z.array(z.string()),
  mode: agentAccessGrantModeSchema,
  status: z.enum(['active', 'revoked', 'consumed', 'expired']),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})
export const managementAgentAccessGrantsResponseSchema = z.object({
  items: z.array(managementAgentAccessGrantSchema),
  pagination: paginationMetadataSchema,
})

export const agentEnrollmentStatusSchema = z.enum(['pending', 'approved', 'denied', 'expired', 'cancelled'])
export const agentEnrollmentSchema = z.object({
  id: z.string(),
  agentId: z.string().nullable(),
  name: z.string(),
  kind: z.enum(['new_identity', 'additional_host']),
  homeSpace: agentHomeSpaceSchema,
  status: agentEnrollmentStatusSchema,
  expiresAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const createAgentEnrollmentSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    organizationId: nonEmptyString.optional(),
    agentId: nonEmptyString.optional(),
  })
  .refine((input) => Boolean(input.name) !== Boolean(input.agentId), {
    message: 'Provide either name for a new Agent or agentId for an additional host.',
  })
  .refine((input) => !(input.agentId && input.organizationId), {
    message: 'An additional host inherits the existing Agent owner.',
    path: ['organizationId'],
  })

export const agentEnrollmentResponseSchema = z.object({
  enrollment: agentEnrollmentSchema,
  verificationUri: z.url(),
})

export const decideAgentEnrollmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('identity'),
    decision: z.literal('approve'),
  }),
  z.object({
    kind: z.literal('protocol'),
    decision: z.enum(['approve', 'deny']),
    userCode: nonEmptyString,
    permissions: z.array(nonEmptyString).optional(),
  }),
])

export const apiResourceAuthorizationSchema = externalResourceAuthorizationSchema.omit({ resourceId: true })
export const apiResourceSchema = apiResourceResponseSchema.extend({
  authorization: apiResourceAuthorizationSchema.nullable(),
})
export const apiResourcesResponseSchema = z.object({
  items: z.array(apiResourceSchema),
  pagination: paginationMetadataSchema,
})
export const createApiResourceSchema = createApiResourceRequestSchema
export const updateApiResourceSchema = updateApiResourceRequestSchema

export const agentApiResourcesResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      identifier: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      resourceUrl: z.url(),
      connectorId: z.string().nullable(),
      status: z.enum(['available', 'unavailable']),
      scopes: z.array(z.object({ value: z.string(), description: z.string().nullable() })),
      accountConnections: z.array(
        z.object({
          id: z.string(),
          displayName: z.string(),
          subjectHint: z.string(),
          scopes: z.array(z.string()),
        }),
      ),
      accessGrants: z.array(z.lazy(() => accessGrantSchema)),
    }),
  ),
  pagination: paginationMetadataSchema,
})

export const connectableApiResourcesResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      identifier: z.string(),
      name: z.string(),
      resourceUrl: z.url(),
    }),
  ),
  pagination: paginationMetadataSchema,
})

export const accountConnectionStatusSchema = z.enum(['pending_authorization', 'active', 'revoked'])
export const accountConnectionSchema = z.object({
  id: z.string(),
  apiResourceId: z.string(),
  owner: z.discriminatedUnion('type', [
    z.object({ type: z.literal('user'), userId: z.string() }),
    z.object({ type: z.literal('organization'), organizationId: z.string() }),
  ]),
  displayName: z.string().nullable(),
  subjectHint: z.string().nullable(),
  scopes: z.array(z.string()),
  status: accountConnectionStatusSchema,
  credentialExpiresAt: z.iso.datetime().nullable(),
  authorizationUrl: z.url().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const createAccountConnectionSchema = z.discriminatedUnion('context', [
  z
    .object({
      context: z.literal('resource'),
      apiResourceId: nonEmptyString,
      owner: z
        .discriminatedUnion('type', [
          z.object({ type: z.literal('user') }),
          z.object({ type: z.literal('organization'), organizationId: nonEmptyString }),
        ])
        .default({ type: 'user' }),
      scopes: scopeListSchema,
    })
    .strict(),
  z
    .object({
      context: z.literal('access-request'),
      accessRequestId: nonEmptyString,
      approvalToken: nonEmptyString,
    })
    .strict(),
])

export const accountConnectionsResponseSchema = z.object({
  items: z.array(accountConnectionSchema),
  pagination: paginationMetadataSchema,
})

export const accessTargetSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('api-resource'),
    apiResourceId: z.string(),
    accountConnectionId: z.string().optional(),
  }),
  z.object({
    type: z.literal('realmroot-management'),
  }),
])

export const createAccessRequestSchema = z
  .object({
    target: accessTargetSchema,
    scopes: scopeListSchema,
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .strict()

export const accessRequestSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  target: accessTargetSchema,
  scopes: z.array(z.string()),
  reason: z.string().nullable(),
  status: agentAccessRequestStatusSchema,
  approval: z
    .object({
      url: z.url(),
      expiresAt: z.iso.datetime(),
    })
    .nullable(),
  grantId: z.string().nullable(),
  expiresAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const accessRequestsResponseSchema = z.object({
  items: z.array(accessRequestSchema),
  pagination: paginationMetadataSchema,
})

export const accessRequestApprovalSchema = accessRequestSchema.extend({
  agent: z.object({ id: z.string(), name: z.string() }),
  resource: z.object({ id: z.string(), name: z.string() }),
})

export const accessRequestApprovalsResponseSchema = z.object({
  items: z.array(accessRequestApprovalSchema),
  pagination: paginationMetadataSchema,
})

export const decideAccessRequestSchema = z
  .object({
    decision: z.enum(['approve', 'deny']),
    mode: agentAccessGrantModeSchema.optional(),
    expiresAt: z.iso.datetime().optional(),
    accountConnectionId: nonEmptyString.optional(),
    approvalToken: nonEmptyString.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.decision === 'approve' && !input.mode) {
      ctx.addIssue({ code: 'custom', path: ['mode'], message: 'Approval mode is required.' })
    }
    if (input.mode === 'until' && !input.expiresAt) {
      ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Limited approval requires expiresAt.' })
    }
  })

export const accessGrantSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  target: z.object({
    type: z.literal('api-resource'),
    apiResourceId: z.string(),
    accountConnectionId: z.string().optional(),
  }),
  scopes: z.array(z.string()),
  mode: agentAccessGrantModeSchema,
  status: z.enum(['active', 'revoked', 'consumed', 'expired']),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const accessGrantsResponseSchema = z.object({
  items: z.array(accessGrantSchema),
  pagination: paginationMetadataSchema,
})

export const targetTokenSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('DPoP'),
  expiresIn: z.number().int().positive().max(3600),
  expiresAt: z.iso.datetime(),
  scopes: z.array(z.string()),
  resourceUrl: z.url(),
})

export type Agent = z.infer<typeof agentSchema>
export type ManagementAgent = z.infer<typeof managementAgentSchema>
export type ManagementAgentHost = z.infer<typeof managementAgentHostSchema>
export type ManagementAgentRole = z.infer<typeof managementAgentRoleSchema>
export type ManagementAgentAccessRequest = z.infer<typeof managementAgentAccessRequestSchema>
export type ManagementAgentAccessGrant = z.infer<typeof managementAgentAccessGrantSchema>
export type AgentInfo = z.infer<typeof agentInfoSchema>
export type AgentEnrollment = z.infer<typeof agentEnrollmentSchema>
export type ApiResource = z.infer<typeof apiResourceSchema>
export type ConnectableApiResourcesResponse = z.infer<typeof connectableApiResourcesResponseSchema>
export type AccountConnection = z.infer<typeof accountConnectionSchema>
export type CreateAccountConnection = z.infer<typeof createAccountConnectionSchema>
export type CreateAccessRequest = z.infer<typeof createAccessRequestSchema>
export type AccessRequest = z.infer<typeof accessRequestSchema>
export type AccessRequestApproval = z.infer<typeof accessRequestApprovalSchema>
export type DecideAccessRequest = z.infer<typeof decideAccessRequestSchema>
export type AccessGrant = z.infer<typeof accessGrantSchema>
