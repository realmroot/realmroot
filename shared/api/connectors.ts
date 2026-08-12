import { z } from 'zod'
import { paginationMetadataSchema, paginationQuerySchema } from './pagination'

export const connectorProviderTypes = ['social', 'generic_oauth'] as const
export const oidcClientRegistrationModes = ['manual', 'dynamic'] as const

export const connectorProviderTypeSchema = z.enum(connectorProviderTypes)
export const oidcClientRegistrationModeSchema = z.enum(oidcClientRegistrationModes)

const nonEmptyString = z.string().trim().min(1)
const optionalUrl = z.url().optional()
const scopesSchema = z.array(nonEmptyString)

export const connectorProviderMetadataSchema = z.record(z.string(), z.unknown())

const connectorEndpointMetadataSchema = z.object({
  issuer: z.string().nullable(),
  authorizationEndpoint: z.string().nullable(),
  tokenEndpoint: z.string().nullable(),
  userInfoEndpoint: z.string().nullable(),
  jwksEndpoint: z.string().nullable(),
})

export const connectorTemplateSchema = z.object({
  providerType: connectorProviderTypeSchema,
  providerId: z.string(),
  displayName: z.string(),
  icon: z.string(),
  requiredFields: z.array(z.string()),
  optionalFields: z.array(z.string()),
  defaultScopes: z.array(z.string()),
  endpoints: connectorEndpointMetadataSchema,
})

export const connectorResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  providerType: connectorProviderTypeSchema,
  providerId: z.string(),
  displayName: z.string(),
  enabled: z.boolean(),
  loginEnabled: z.boolean(),
  clientId: z.string().nullable(),
  clientSecretConfigured: z.boolean(),
  issuer: z.string().nullable(),
  authorizationEndpoint: z.string().nullable(),
  tokenEndpoint: z.string().nullable(),
  userInfoEndpoint: z.string().nullable(),
  jwksEndpoint: z.string().nullable(),
  registrationEndpoint: z.string().nullable(),
  revocationEndpoint: z.string().nullable(),
  registrationMode: oidcClientRegistrationModeSchema.nullable(),
  scopes: z.array(z.string()),
  providerMetadata: connectorProviderMetadataSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const connectorReadinessResponseSchema = z.object({
  connectorId: z.string(),
  ready: z.boolean(),
  checks: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      ok: z.boolean(),
      message: z.string(),
    }),
  ),
})

export const createConnectorRequestSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(3)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    providerType: connectorProviderTypeSchema,
    providerId: nonEmptyString,
    displayName: nonEmptyString,
    enabled: z.boolean().optional(),
    loginEnabled: z.boolean().optional(),
    registrationMode: oidcClientRegistrationModeSchema.optional(),
    clientId: nonEmptyString.optional(),
    clientSecret: nonEmptyString.optional(),
    issuer: optionalUrl,
    authorizationEndpoint: optionalUrl,
    tokenEndpoint: optionalUrl,
    userInfoEndpoint: optionalUrl,
    jwksEndpoint: optionalUrl,
    scopes: scopesSchema.optional(),
    providerMetadata: connectorProviderMetadataSchema.optional(),
  })
  .superRefine((input, ctx) => {
    validateConnectorFields(input, ctx)
  })

export const updateConnectorRequestSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(3)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  displayName: nonEmptyString.optional(),
  enabled: z.boolean().optional(),
  loginEnabled: z.boolean().optional(),
  clientId: nonEmptyString.nullable().optional(),
  clientSecret: nonEmptyString.nullable().optional(),
  scopes: scopesSchema.optional(),
  providerMetadata: connectorProviderMetadataSchema.optional(),
})

export const listConnectorsResponseSchema = z.object({
  items: z.array(connectorResponseSchema),
  pagination: paginationMetadataSchema,
})

export const listConnectorTemplatesResponseSchema = z.object({
  items: z.array(connectorTemplateSchema),
})

export const linkAccountRequestSchema = z.object({
  providerType: connectorProviderTypeSchema,
  providerId: nonEmptyString,
  callbackURL: nonEmptyString,
  errorCallbackURL: nonEmptyString.optional(),
  scopes: z.array(nonEmptyString).optional(),
})

export const unlinkAccountQuerySchema = z.object({
  accountId: z.string().trim().min(1).optional(),
})

type ConnectorBoundaryInput = z.infer<typeof createConnectorRequestSchema>

function validateConnectorFields(input: ConnectorBoundaryInput, ctx: z.RefinementCtx) {
  const dynamicOidc = input.providerType === 'generic_oauth' && input.registrationMode === 'dynamic'
  if (input.providerType === 'generic_oauth' && !input.issuer) {
    ctx.addIssue({
      code: 'custom',
      path: ['issuer'],
      message: 'OIDC connectors require an issuer.',
    })
  }
  if (
    input.providerType === 'generic_oauth' &&
    input.issuer &&
    (input.authorizationEndpoint || input.tokenEndpoint || input.userInfoEndpoint || input.jwksEndpoint)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['issuer'],
      message: 'OIDC endpoints are discovered from the issuer and cannot be supplied explicitly.',
    })
  }
  if (input.enabled === false && input.providerType === 'social') return
  if (!dynamicOidc && !input.clientId) {
    ctx.addIssue({ code: 'custom', path: ['clientId'], message: 'clientId is required.' })
  }
  if (!dynamicOidc && !input.clientSecret) {
    ctx.addIssue({
      code: 'custom',
      path: ['clientSecret'],
      message: 'clientSecret is required.',
    })
  }
}

export { paginationQuerySchema }

export type ConnectorProviderType = z.infer<typeof connectorProviderTypeSchema>
export type ConnectorResponse = z.infer<typeof connectorResponseSchema>
export type ConnectorTemplate = z.infer<typeof connectorTemplateSchema>
export type ConnectorReadinessResponse = z.infer<typeof connectorReadinessResponseSchema>
export type OidcClientRegistrationMode = z.infer<typeof oidcClientRegistrationModeSchema>
export type ListConnectorTemplatesResponse = z.infer<typeof listConnectorTemplatesResponseSchema>
export type CreateConnectorRequest = z.infer<typeof createConnectorRequestSchema>
export type UpdateConnectorRequest = z.infer<typeof updateConnectorRequestSchema>
export type LinkAccountRequest = z.infer<typeof linkAccountRequestSchema>
