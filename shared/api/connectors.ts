import { z } from 'zod'
import { paginationQuerySchema } from './pagination'

export const connectorProviderTypes = ['social', 'generic_oauth'] as const

export const connectorProviderTypeSchema = z.enum(connectorProviderTypes)

const nonEmptyString = z.string().trim().min(1)
const optionalUrl = z.url().optional()
const nullableUrl = z.url().nullable()
const scopesSchema = z.array(nonEmptyString)
const paginationMetadataSchema = z.object({
  limit: z.number().int().positive(),
  offset: z.number().int().min(0),
  total: z.number().int().min(0),
  nextOffset: z.number().int().min(0).nullable(),
})

export const connectorProviderMetadataSchema = z.record(z.string(), z.unknown())

export const connectorTemplateSchema = z.object({
  providerType: connectorProviderTypeSchema,
  providerId: z.string(),
  displayName: z.string(),
  requiredFields: z.array(z.string()),
  optionalFields: z.array(z.string()),
  defaultScopes: z.array(z.string()),
})

export const connectorResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  providerType: connectorProviderTypeSchema,
  providerId: z.string(),
  displayName: z.string(),
  enabled: z.boolean(),
  clientId: z.string().nullable(),
  clientSecretBinding: z.string().nullable(),
  issuer: z.string().nullable(),
  authorizationEndpoint: z.string().nullable(),
  tokenEndpoint: z.string().nullable(),
  userInfoEndpoint: z.string().nullable(),
  jwksEndpoint: z.string().nullable(),
  scopes: z.array(z.string()),
  providerMetadata: connectorProviderMetadataSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
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
    clientId: nonEmptyString.optional(),
    clientSecretBinding: nonEmptyString.optional(),
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
  clientId: nonEmptyString.nullable().optional(),
  clientSecretBinding: nonEmptyString.nullable().optional(),
  issuer: nullableUrl.optional(),
  authorizationEndpoint: nullableUrl.optional(),
  tokenEndpoint: nullableUrl.optional(),
  userInfoEndpoint: nullableUrl.optional(),
  jwksEndpoint: nullableUrl.optional(),
  scopes: scopesSchema.optional(),
  providerMetadata: connectorProviderMetadataSchema.optional(),
})

export const listConnectorsResponseSchema = z.object({
  connectors: z.array(connectorResponseSchema),
  pagination: paginationMetadataSchema,
})

export const listConnectorTemplatesResponseSchema = z.object({
  templates: z.array(connectorTemplateSchema),
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
  if (!input.clientId) {
    ctx.addIssue({ code: 'custom', path: ['clientId'], message: 'clientId is required.' })
  }
  if (!input.clientSecretBinding) {
    ctx.addIssue({
      code: 'custom',
      path: ['clientSecretBinding'],
      message: 'clientSecretBinding is required.',
    })
  }
  if (input.providerType !== 'generic_oauth') return

  if (!input.issuer && !input.authorizationEndpoint) {
    ctx.addIssue({
      code: 'custom',
      path: ['issuer'],
      message: 'Generic OAuth requires issuer or authorizationEndpoint.',
    })
  }
  if (!input.issuer && !input.tokenEndpoint) {
    ctx.addIssue({
      code: 'custom',
      path: ['tokenEndpoint'],
      message: 'Generic OAuth requires tokenEndpoint when issuer is not provided.',
    })
  }
}

export { paginationQuerySchema }

export type ConnectorProviderType = z.infer<typeof connectorProviderTypeSchema>
export type ConnectorResponse = z.infer<typeof connectorResponseSchema>
export type ConnectorTemplate = z.infer<typeof connectorTemplateSchema>
export type CreateConnectorRequest = z.infer<typeof createConnectorRequestSchema>
export type UpdateConnectorRequest = z.infer<typeof updateConnectorRequestSchema>
export type LinkAccountRequest = z.infer<typeof linkAccountRequestSchema>
