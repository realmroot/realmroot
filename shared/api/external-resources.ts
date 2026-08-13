import { z } from 'zod'
import { authorizationDetailsSchema } from './authorization-details'
import { oidcClientRegistrationModeSchema } from './connectors'

const nonEmptyString = z.string().trim().min(1)
const scopeListSchema = z
  .array(nonEmptyString)
  .min(1)
  .transform((values) => [...new Set(values)].sort())

export const externalAuthorizationStatusSchema = z.enum(['pending', 'active', 'invalid'])

export const providerConnectionEventTypeSchema = z.enum([
  'authorityChanged',
  'resourcesChanged',
  'suspended',
  'restored',
  'revoked',
])

const providerConnectionEventScopeListSchema = z
  .array(nonEmptyString)
  .transform((values) => [...new Set(values)].sort())

export const providerAuthorityConstraintSchema = z
  .object({
    authorizationDetails: authorizationDetailsSchema.min(1),
    scopes: providerConnectionEventScopeListSchema,
  })
  .strict()

export const providerAuthorityConstraintsSchema = z.array(providerAuthorityConstraintSchema)

const providerConnectionEventCommonShape = {
  brokerReference: nonEmptyString,
  occurredAt: z.iso
    .datetime({ offset: true })
    .describe('Provider occurrence time retained as audit metadata; it does not determine mutation order.'),
  revision: z.number().int().positive().describe('Monotonic per-connection revision used as the sole mutation order.'),
}

export const providerConnectionEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...providerConnectionEventCommonShape,
      type: z.literal('authorityChanged'),
      scopes: providerConnectionEventScopeListSchema,
      affectedScopes: providerConnectionEventScopeListSchema,
      affectedAuthorizationDetails: authorizationDetailsSchema.min(1),
      authorityConstraints: providerAuthorityConstraintsSchema,
    })
    .strict(),
  z
    .object({
      ...providerConnectionEventCommonShape,
      type: z.literal('resourcesChanged'),
      scopes: providerConnectionEventScopeListSchema,
      authorizationDetails: authorizationDetailsSchema,
      authorityConstraints: providerAuthorityConstraintsSchema,
    })
    .strict(),
  z
    .object({
      ...providerConnectionEventCommonShape,
      type: z.literal('restored'),
      scopes: providerConnectionEventScopeListSchema,
      authorizationDetails: authorizationDetailsSchema,
      authorityConstraints: providerAuthorityConstraintsSchema,
    })
    .strict(),
  z.object({ ...providerConnectionEventCommonShape, type: z.enum(['suspended', 'revoked']) }).strict(),
])

export const providerConnectionEventIdSchema = nonEmptyString.max(200)

export const externalResourceAuthorizationSchema = z.object({
  resourceId: z.string(),
  connectorId: z.string(),
  resourceUrl: z.url(),
  issuer: z.url(),
  authorizationEndpoint: z.url(),
  tokenEndpoint: z.url(),
  pushedAuthorizationRequestEndpoint: z.url().nullable(),
  authorizationDetailsTypesSupported: z.array(z.string()),
  authorizationDetailsCatalogEndpoint: z.url().nullable(),
  authorizationDetailsCatalogScope: z.string().nullable(),
  registrationEndpoint: z.url().nullable(),
  revocationEndpoint: z.url(),
  jwksUri: z.url().nullable(),
  userInfoEndpoint: z.url().nullable(),
  registrationMode: oidcClientRegistrationModeSchema,
  clientId: z.string(),
  clientSecretConfigured: z.literal(true),
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
  scopes: scopeListSchema,
  authorizationDetails: authorizationDetailsSchema.optional(),
  returnTo: z.enum(['account-center', 'access-approval', 'connection-approval']).optional(),
})

export const resourceConnectionIntentResponseSchema = z.object({
  authorizationUrl: z.url(),
  expiresAt: z.iso.datetime(),
})

export const resourceConnectionCallbackQuerySchema = z.union([
  z.object({
    state: nonEmptyString,
    code: nonEmptyString,
    error: z.never().optional(),
  }),
  z.object({
    state: nonEmptyString,
    error: nonEmptyString.max(128),
    error_description: z.string().trim().min(1).max(1000).optional(),
  }),
])

export const providerResourceAuthorizationSchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  owner: z.discriminatedUnion('type', [
    z.object({ type: z.literal('user'), userId: z.string() }),
    z.object({ type: z.literal('organization'), organizationId: z.string() }),
  ]),
  externalSubject: z.string(),
  displayName: z.string(),
  grantedScopes: z.array(z.string()),
  authorizationDetails: authorizationDetailsSchema,
  authorityConstraints: providerAuthorityConstraintsSchema,
  status: z.enum(['active', 'suspended', 'revoked']),
  credentialExpiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const listResourceConnectionsResponseSchema = z.object({
  items: z.array(providerResourceAuthorizationSchema),
})

export const connectableExternalResourcesResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      identifier: z.string(),
      name: z.string(),
      resourceUrl: z.url(),
    }),
  ),
})

export const permissionModeSchema = z.enum(['once', 'until', 'persistent'])
export const agentAccessRequestStatusSchema = z.enum(['pending', 'approved', 'denied', 'consumed', 'expired'])

export const createAgentAccessRequestSchema = z.object({
  resourceId: nonEmptyString,
  scopes: scopeListSchema,
  authorizationDetails: authorizationDetailsSchema.default([]),
  reason: z.string().trim().max(500).nullable().optional(),
})

export const agentAccessRequestSchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  connectionId: z.string().nullable(),
  agentIdentityId: z.string(),
  hostId: z.string(),
  scopes: z.array(z.string()),
  authorizationDetails: authorizationDetailsSchema,
  reason: z.string().nullable(),
  status: agentAccessRequestStatusSchema,
  approvalUrl: z.url().nullable(),
  expiresAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const decideAgentAccessRequestSchema = z.object({
  decision: z.enum(['approve', 'deny']),
  mode: permissionModeSchema.optional(),
  expiresAt: z.iso.datetime().optional(),
  authorizationDetails: authorizationDetailsSchema.default([]),
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

export type ExternalResourceAuthorizationRecord = z.infer<typeof externalResourceAuthorizationSchema>
export type ProviderConnectionEvent = z.infer<typeof providerConnectionEventSchema>
export type ProviderAuthorityConstraint = z.infer<typeof providerAuthorityConstraintSchema>
export type CreateResourceConnectionIntentRequest = z.infer<typeof createResourceConnectionIntentRequestSchema>
export type CreateAgentAccessRequest = z.input<typeof createAgentAccessRequestSchema>
export type DecideAgentAccessRequest = z.input<typeof decideAgentAccessRequestSchema>
export type ConnectableExternalResourcesResponse = z.infer<typeof connectableExternalResourcesResponseSchema>
export type ListResourceConnectionsResponse = z.infer<typeof listResourceConnectionsResponseSchema>
export type ResourceConnectionIntentResponse = z.infer<typeof resourceConnectionIntentResponseSchema>
export type AgentAccessRequest = z.infer<typeof agentAccessRequestSchema>
