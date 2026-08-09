import { z } from 'zod'
import { agentAuditEventSchema, agentHomeSpaceSchema, agentIdentityStatusSchema } from './agents'
import {
  apiResourceResponseSchema,
  createApiResourceRequestSchema,
  scopeEntitlementListStatusSchema,
  updateApiResourceRequestSchema,
} from './authorization'
import { authorizationDetailCatalogItemSchema, authorizationDetailsSchema } from './authorization-details'
import {
  agentAccessRequestStatusSchema,
  externalResourceAuthorizationSchema,
  resourceScopeEntitlementModeSchema,
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
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const agentResponseSchema = z.object({ agent: agentSchema })
export const agentStatusSchema = z.object({
  enrollment: z.object({
    state: z.enum(['unenrolled', 'enrolled']),
    pending: z.null(),
  }),
  agent: agentSchema.nullable(),
  installation: z
    .object({
      id: z.string(),
      status: z.enum(['active', 'revoked']),
    })
    .nullable(),
})

export const createAgentSelfEnrollmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('new_identity'),
    name: z.string().trim().min(1).max(100),
    organizationId: nonEmptyString.optional(),
  }),
  z.object({
    kind: z.literal('additional_installation'),
    agentId: nonEmptyString,
  }),
])
export const managementAgentSchema = agentSchema.extend({
  owner: z.object({
    id: z.string(),
    type: z.enum(['user', 'organization']),
    displayName: z.string(),
  }),
  installationCount: z.number().int().nonnegative(),
  pendingRequestCount: z.number().int().nonnegative(),
  activeResourceCount: z.number().int().nonnegative(),
  activeScopeCount: z.number().int().nonnegative(),
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
export const managementAgentAuditEventSchema = agentAuditEventSchema.extend({
  resource: z
    .object({
      id: z.string(),
      identifier: z.string(),
      name: z.string(),
    })
    .nullable(),
})
export const auditEventsResponseSchema = z.object({
  items: z.array(managementAgentAuditEventSchema),
  pagination: paginationMetadataSchema,
})
export const listAgentAuditEventsQuerySchema = paginationQuerySchema.extend({
  organizationId: nonEmptyString.optional(),
  agentId: nonEmptyString.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  action: nonEmptyString.optional(),
  result: z.enum(['allowed', 'denied', 'pending']).optional(),
})
export type ListAgentAuditEventsQuery = z.infer<typeof listAgentAuditEventsQuerySchema>

export const managementAgentInstallationSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  credentialType: z.enum(['public_key', 'remote_jwks']),
  boundAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime().nullable(),
})
export const managementAgentInstallationsResponseSchema = z.object({
  items: z.array(managementAgentInstallationSchema),
  pagination: paginationMetadataSchema,
})

const managementAgentResourceSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  name: z.string(),
})
export const managementAgentAccessRequestSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  resource: managementAgentResourceSchema,
  scopes: z.array(z.string()),
  authorizationDetails: authorizationDetailsSchema,
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
export const listManagementAgentAccessRequestsQuerySchema = paginationQuerySchema.extend({
  agentId: nonEmptyString.optional(),
  organizationId: nonEmptyString.optional(),
  resourceId: nonEmptyString.optional(),
  status: agentAccessRequestStatusSchema.optional(),
})

export const agentScopeEntitlementSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  target: z.object({
    type: z.literal('api-resource'),
    apiResourceId: z.string(),
    accountConnectionId: z.string().optional(),
  }),
  resource: managementAgentResourceSchema,
  scope: z.string(),
  authorizationDetails: authorizationDetailsSchema,
  mode: resourceScopeEntitlementModeSchema,
  status: z.enum(['active', 'ended']),
  sourceAccessRequestId: z.string().nullable(),
  endedAt: z.iso.datetime().nullable(),
  endReason: z.enum(['revoked', 'consumed', 'expired', 'merged']).nullable(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  links: z.object({ self: z.string() }),
})
export const agentScopeEntitlementsResponseSchema = z.object({
  items: z.array(agentScopeEntitlementSchema),
  pagination: paginationMetadataSchema,
})
export const listAgentScopeEntitlementsQuerySchema = paginationQuerySchema.extend({
  resourceId: nonEmptyString.optional(),
  status: scopeEntitlementListStatusSchema.optional(),
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

export const createAgentEnrollmentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  organizationId: nonEmptyString.optional(),
})

export const createAgentInstallationEnrollmentSchema = z.object({
  agentId: nonEmptyString,
})

export const agentInstallationEnrollmentSchema = agentEnrollmentSchema.extend({
  kind: z.literal('additional_host'),
})

export const agentInstallationEnrollmentResponseSchema = z.object({
  enrollment: agentInstallationEnrollmentSchema,
  verificationUri: z.url(),
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
export const createApiResourceSchema = createApiResourceRequestSchema
export const updateApiResourceSchema = updateApiResourceRequestSchema

export const resourceServerConnectionSummarySchema = z.object({
  status: z.enum(['connected', 'not_connected', 'not_required']),
  displayName: z.string().nullable(),
  authorizedScopes: z.array(z.string()),
})

export const resourceServerSchema = apiResourceResponseSchema.extend({
  authorization: apiResourceAuthorizationSchema.nullable(),
  availability: z.object({
    status: z.enum(['available', 'unavailable']),
    checkedAt: z.iso.datetime(),
  }),
  scopes: z.array(z.object({ value: z.string(), description: z.string().nullable() })),
  connection: resourceServerConnectionSummarySchema.nullable(),
  links: z.object({
    self: z.url(),
    resources: z.url(),
    connectionRequests: z.url().nullable(),
  }),
})

export const resourceServersResponseSchema = z.object({
  items: z.array(resourceServerSchema),
  pagination: paginationMetadataSchema,
})

export const apiResourceSchema = resourceServerSchema
export const apiResourcesResponseSchema = resourceServersResponseSchema

export const resourceReferenceSchema = z.object({ href: nonEmptyString })

export const resourceServerResourceSchema = z.object({
  id: z.string(),
  type: nonEmptyString,
  name: nonEmptyString,
  description: z.string().nullable(),
  metadata: z.record(nonEmptyString, z.string()),
  accountAuthorization: z.object({
    status: z.enum(['authorized', 'authorization_required', 'not_required']),
  }),
  agentAuthorization: z.object({
    authorizedScopes: z.array(z.string()),
    requestableScopes: z.array(z.string()),
  }),
  links: z.object({ self: z.url(), accessRequests: z.url() }),
})

export const resourceServerResourcesResponseSchema = z.object({
  items: z.array(resourceServerResourceSchema),
  pagination: paginationMetadataSchema,
})

// Controller-facing approval data keeps the provider protocol payload private
// from Agents while allowing the hosted consent page to submit the exact RAR boundary.
export const authorizationDetailCatalogEntrySchema = authorizationDetailCatalogItemSchema.extend({
  connectionStatus: z.enum(['authorized', 'authorization_required']),
  authorizedScopes: z.array(z.string()),
  requestableScopes: z.array(z.string()),
})
export const authorizationDetailCatalogResponseSchema = z.object({
  items: z.array(authorizationDetailCatalogEntrySchema),
  pagination: paginationMetadataSchema,
  connection: z.object({ status: z.enum(['connected', 'not_connected']) }),
})

export const interactionStatusSchema = z.enum(['pending', 'completed', 'denied', 'expired', 'failed'])
export const interactiveResourceProfile = 'https://realmroot.dev/profiles/interactive-resource'
export const credentialOfferProfile = 'https://realmroot.dev/profiles/resource-credential-offer'

export const interactionSchema = z.object({
  type: z.literal('user-approval'),
  status: interactionStatusSchema,
  url: z.url().nullable(),
  expiresAt: z.iso.datetime().nullable(),
})

export const targetCredentialProofSchema = z.object({
  proof: z.object({ type: z.literal('dpop+jwt'), value: nonEmptyString }),
})

export const dpopNonceErrorResponseSchema = z.object({
  error: z.literal('use_dpop_nonce'),
  error_description: nonEmptyString,
})

export const resourceLinksSchema = z.object({ self: nonEmptyString })

export const capabilityRequestSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  capabilities: z.array(z.object({ value: z.string(), status: z.string() })),
  status: z.enum(['pending', 'completed', 'denied', 'expired', 'failed']),
  interaction: interactionSchema,
  links: resourceLinksSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
})

export const createResourceConnectionRequestSchema = z
  .object({
    resources: z.array(resourceReferenceSchema).default([]),
    scopes: scopeListSchema,
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .strict()

export const resourceConnectionRequestSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  resourceServerId: z.string(),
  resources: z.array(resourceReferenceSchema),
  scopes: z.array(z.string()),
  reason: z.string().nullable(),
  status: z.enum(['pending', 'connected', 'denied', 'expired']),
  interaction: interactionSchema,
  links: resourceLinksSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
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

export const accountConnectionStatusSchema = z.enum(['pending_authorization', 'active', 'suspended', 'revoked'])
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
  authorizationDetails: authorizationDetailsSchema,
  status: accountConnectionStatusSchema,
  credentialExpiresAt: z.iso.datetime().nullable(),
  authorizationUrl: z.url().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const resourceConnectionApprovalSchema = resourceConnectionRequestSchema.extend({
  agent: z.object({ id: z.string(), name: z.string() }),
  resource: z.object({ id: z.string(), name: z.string() }),
  accountConnection: accountConnectionSchema.nullable(),
})

export const resourceConnectionApprovalTokenSchema = z.object({
  id: z.string(),
  agentIdentityId: z.string(),
  bindingId: z.string(),
  resourceId: z.string(),
  scopes: z.array(z.string()).min(1),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
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
  z
    .object({
      context: z.literal('connection-request'),
      approvalToken: nonEmptyString,
    })
    .strict(),
])

export const accountConnectionsResponseSchema = z.object({
  items: z.array(accountConnectionSchema),
  pagination: paginationMetadataSchema,
})

export const accessTargetSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('resource'),
      resource: resourceReferenceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('realmroot-management'),
    })
    .strict(),
])

export const createAccessRequestSchema = z
  .object({
    resource: resourceReferenceSchema,
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
  interaction: interactionSchema,
  links: resourceLinksSchema.extend({ credentials: nonEmptyString.nullable() }),
  credentialOffer: z
    .object({
      type: z.literal('dpop'),
      resource: resourceReferenceSchema,
      resourceIndicator: z.url(),
      endpoint: z.url(),
      proof: z.object({ algorithm: z.literal('ES256'), method: z.literal('POST'), uri: z.url() }),
    })
    .nullable(),
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
  authorizationDetails: authorizationDetailsSchema,
  requiresAccountConnection: z.boolean(),
  agent: z.object({ id: z.string(), name: z.string() }),
  resourceServer: z.object({ id: z.string(), name: z.string() }),
  resource: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    description: z.string().nullable(),
    metadata: z.record(z.string(), z.string()),
    authorizationDetailTemplates: authorizationDetailsSchema,
  }),
})

export const accessRequestApprovalsResponseSchema = z.object({
  items: z.array(accessRequestApprovalSchema),
  pagination: paginationMetadataSchema,
})

export const decideAccessRequestSchema = z
  .object({
    decision: z.enum(['approve', 'deny']),
    mode: resourceScopeEntitlementModeSchema.optional(),
    expiresAt: z.iso.datetime().optional(),
    authorizationDetails: authorizationDetailsSchema.default([]),
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

export const targetTokenSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('DPoP'),
  expiresIn: z.number().int().positive().max(3600),
  expiresAt: z.iso.datetime(),
  scopes: z.array(z.string()),
  authorizationDetails: authorizationDetailsSchema,
  resourceIndicator: z.url(),
  resource: resourceReferenceSchema,
})

export type Agent = z.infer<typeof agentSchema>
export type ManagementAgent = z.infer<typeof managementAgentSchema>
export type ManagementAgentInstallation = z.infer<typeof managementAgentInstallationSchema>
export type ManagementAgentAuditEvent = z.infer<typeof managementAgentAuditEventSchema>
export type ManagementAgentAccessRequest = z.infer<typeof managementAgentAccessRequestSchema>
export type ListManagementAgentAccessRequestsQuery = z.infer<typeof listManagementAgentAccessRequestsQuerySchema>
export type ListAgentScopeEntitlementsQuery = z.infer<typeof listAgentScopeEntitlementsQuerySchema>
export type AgentEnrollment = z.infer<typeof agentEnrollmentSchema>
export type ApiResource = ResourceServer
export type ConnectableApiResourcesResponse = z.infer<typeof connectableApiResourcesResponseSchema>
export type AccountConnection = z.infer<typeof accountConnectionSchema>
export type AuthorizationDetailCatalogEntry = z.infer<typeof authorizationDetailCatalogEntrySchema>
export type CreateAccountConnection = z.infer<typeof createAccountConnectionSchema>
export type CreateResourceConnectionRequest = z.input<typeof createResourceConnectionRequestSchema>
export type ResourceConnectionRequest = z.infer<typeof resourceConnectionRequestSchema>
export type ResourceConnectionApproval = z.infer<typeof resourceConnectionApprovalSchema>
export type ResourceConnectionApprovalToken = z.infer<typeof resourceConnectionApprovalTokenSchema>
export type CreateAccessRequest = z.input<typeof createAccessRequestSchema>
export type AccessRequest = z.infer<typeof accessRequestSchema>
export type AccessRequestApproval = z.infer<typeof accessRequestApprovalSchema>
export type DecideAccessRequest = z.input<typeof decideAccessRequestSchema>
export type AgentScopeEntitlement = z.infer<typeof agentScopeEntitlementSchema>
export type ResourceServer = z.infer<typeof resourceServerSchema>
export type ResourceServerResource = z.infer<typeof resourceServerResourceSchema>
