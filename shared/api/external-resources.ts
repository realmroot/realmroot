import { z } from 'zod'

const nonEmptyString = z.string().trim().min(1)
const scopeListSchema = z
  .array(nonEmptyString)
  .min(1)
  .transform((values) => [...new Set(values)].sort())

export const externalAuthorizationStatusSchema = z.enum(['pending', 'active', 'invalid'])
export const externalClientRegistrationModeSchema = z.enum(['dynamic', 'manual'])

export const configureExternalResourceAuthorizationRequestSchema = z
  .object({
    resourceUrl: z.url(),
    registrationMode: externalClientRegistrationModeSchema,
    clientId: nonEmptyString.optional(),
    clientSecret: nonEmptyString.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.registrationMode !== 'manual') return
    if (!input.clientId) {
      ctx.addIssue({ code: 'custom', path: ['clientId'], message: 'Manual registration requires clientId.' })
    }
    if (!input.clientSecret) {
      ctx.addIssue({ code: 'custom', path: ['clientSecret'], message: 'Manual registration requires clientSecret.' })
    }
  })

export const externalResourceAuthorizationSchema = z.object({
  resourceId: z.string(),
  resourceUrl: z.url(),
  issuer: z.url(),
  authorizationEndpoint: z.url(),
  tokenEndpoint: z.url(),
  registrationEndpoint: z.url().nullable(),
  revocationEndpoint: z.url(),
  jwksUri: z.url(),
  userInfoEndpoint: z.url().nullable(),
  registrationMode: externalClientRegistrationModeSchema,
  clientId: z.string(),
  clientSecretConfigured: z.literal(true),
  scopesSupported: z.array(z.string()),
  status: externalAuthorizationStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const resourceConnectionOwnerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user') }),
  z.object({ type: z.literal('organization'), organizationId: nonEmptyString }),
])

export const createResourceConnectionIntentRequestSchema = z.object({
  owner: resourceConnectionOwnerSchema.default({ type: 'user' }),
  scopes: scopeListSchema.optional(),
})

export const resourceConnectionIntentResponseSchema = z.object({
  authorizationUrl: z.url(),
  expiresAt: z.iso.datetime(),
})

export const resourceConnectionCallbackQuerySchema = z.object({
  state: nonEmptyString,
  code: nonEmptyString,
})

export const resourceAccountConnectionSchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  owner: z.discriminatedUnion('type', [
    z.object({ type: z.literal('user'), userId: z.string() }),
    z.object({ type: z.literal('organization'), organizationId: z.string() }),
  ]),
  externalSubject: z.string(),
  displayName: z.string(),
  grantedScopes: z.array(z.string()),
  status: z.enum(['active', 'revoked']),
  credentialExpiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const listResourceConnectionsResponseSchema = z.object({
  connections: z.array(resourceAccountConnectionSchema),
})

export const connectableExternalResourcesResponseSchema = z.object({
  resources: z.array(
    z.object({
      id: z.string(),
      identifier: z.string(),
      name: z.string(),
      audience: z.string(),
      resourceUrl: z.url(),
      scopes: z.array(z.object({ value: z.string(), description: z.string().nullable() })),
    }),
  ),
})

export const agentAccessGrantModeSchema = z.enum(['once', 'until', 'persistent'])
export const agentAccessRequestStatusSchema = z.enum(['pending', 'approved', 'denied', 'consumed', 'expired'])

export const createAgentAccessRequestSchema = z.object({
  resourceId: nonEmptyString,
  connectionId: nonEmptyString,
  scopes: scopeListSchema,
  reason: z.string().trim().max(500).nullable().optional(),
})

export const agentAccessRequestSchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  connectionId: z.string(),
  agentIdentityId: z.string(),
  hostId: z.string(),
  scopes: z.array(z.string()),
  reason: z.string().nullable(),
  status: agentAccessRequestStatusSchema,
  approvalUrl: z.url().nullable(),
  grantId: z.string().nullable(),
  expiresAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const decideAgentAccessRequestSchema = z.object({
  decision: z.enum(['approve', 'deny']),
  mode: agentAccessGrantModeSchema.optional(),
  expiresAt: z.iso.datetime().optional(),
})

export const agentAccessApprovalTokenQuerySchema = z.object({ token: nonEmptyString })
export const decideAgentAccessRequestByTokenSchema = decideAgentAccessRequestSchema
  .and(z.object({ token: nonEmptyString }))
  .superRefine((input, ctx) => {
    if (input.decision === 'approve' && !input.mode) {
      ctx.addIssue({ code: 'custom', path: ['mode'], message: 'Approval mode is required.' })
    }
    if (input.mode === 'until' && !input.expiresAt) {
      ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Limited approval requires expiresAt.' })
    }
  })

export const agentAccessGrantSchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  connectionId: z.string(),
  agentIdentityId: z.string(),
  scopes: z.array(z.string()),
  mode: agentAccessGrantModeSchema,
  status: z.enum(['active', 'revoked', 'consumed', 'expired']),
  grantedByUserId: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const agentResourceDiscoverySchema = z.object({
  resources: z.array(
    z.object({
      id: z.string(),
      identifier: z.string(),
      name: z.string(),
      audience: z.string(),
      scopes: z.array(z.object({ value: z.string(), description: z.string().nullable() })),
      connections: z.array(
        z.object({
          id: z.string(),
          displayName: z.string(),
          subjectHint: z.string(),
          grantedScopes: z.array(z.string()),
        }),
      ),
      grants: z.array(agentAccessGrantSchema),
    }),
  ),
})

export const createExternalTokenLeaseRequestSchema = z.object({
  dpopProof: nonEmptyString,
})

export const externalTokenLeaseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('DPoP'),
  expiresIn: z.number().int().positive().max(3600),
  scope: z.string(),
  resource: z.string(),
})

export type ConfigureExternalResourceAuthorizationRequest = z.infer<
  typeof configureExternalResourceAuthorizationRequestSchema
>
export type ExternalResourceAuthorizationRecord = z.infer<typeof externalResourceAuthorizationSchema>
export type CreateResourceConnectionIntentRequest = z.infer<typeof createResourceConnectionIntentRequestSchema>
export type CreateAgentAccessRequest = z.infer<typeof createAgentAccessRequestSchema>
export type DecideAgentAccessRequest = z.infer<typeof decideAgentAccessRequestSchema>
export type CreateExternalTokenLeaseRequest = z.infer<typeof createExternalTokenLeaseRequestSchema>
export type ConnectableExternalResourcesResponse = z.infer<typeof connectableExternalResourcesResponseSchema>
export type ListResourceConnectionsResponse = z.infer<typeof listResourceConnectionsResponseSchema>
export type ResourceConnectionIntentResponse = z.infer<typeof resourceConnectionIntentResponseSchema>
export type AgentAccessRequest = z.infer<typeof agentAccessRequestSchema>
