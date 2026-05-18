import { z } from 'zod'

export const applicationClientTypes = ['public_spa', 'public_native', 'confidential_web'] as const
export const applicationGrantTypes = ['authorization_code', 'refresh_token', 'client_credentials'] as const
export const applicationScopes = ['openid', 'profile', 'email', 'offline_access'] as const

export const applicationClientTypeSchema = z.enum(applicationClientTypes)
export const applicationGrantTypeSchema = z.enum(applicationGrantTypes)
export const applicationScopeSchema = z.enum(applicationScopes)

const nonEmptyString = z.string().trim().min(1)
const optionalUrl = z.url().optional()

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const paginationMetadataSchema = z.object({
  limit: z.number().int().positive(),
  offset: z.number().int().min(0),
  total: z.number().int().min(0),
  hasMore: z.boolean(),
  nextOffset: z.number().int().min(0).nullable(),
})

export const applicationSecretMetadataSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  prefix: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
})

export const oidcEndpointMetadataSchema = z.object({
  issuer: z.string(),
  authorizationEndpoint: z.string(),
  tokenEndpoint: z.string(),
  jwksUri: z.string(),
  userInfoEndpoint: z.string(),
  endSessionEndpoint: z.string(),
})

export const applicationResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  homepageUrl: z.string().nullable(),
  iconUrl: z.string().nullable(),
  clientId: z.string(),
  clientType: applicationClientTypeSchema,
  public: z.boolean(),
  firstParty: z.boolean(),
  trusted: z.boolean(),
  disabled: z.boolean(),
  disabledReason: z.string().nullable(),
  redirectUris: z.array(z.string()),
  allowedGrantTypes: z.array(applicationGrantTypeSchema),
  allowedScopes: z.array(applicationScopeSchema),
  requirePkce: z.boolean(),
  tokenEndpointAuthMethod: z.enum(['none', 'client_secret_basic', 'client_secret_post']),
  secretMetadata: z.array(applicationSecretMetadataSchema),
  oidc: oidcEndpointMetadataSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const createApplicationRequestSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(3)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  name: nonEmptyString,
  description: z.string().trim().max(1000).optional(),
  homepageUrl: optionalUrl,
  iconUrl: optionalUrl,
  clientType: applicationClientTypeSchema,
  redirectUris: z.array(nonEmptyString).min(1),
  allowedGrantTypes: z.array(applicationGrantTypeSchema).min(1).optional(),
  allowedScopes: z.array(applicationScopeSchema).min(1).optional(),
  firstParty: z.boolean().optional(),
  trusted: z.boolean().optional(),
})

export const updateApplicationRequestSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(3)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  name: nonEmptyString.optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  homepageUrl: optionalUrl.nullable(),
  iconUrl: optionalUrl.nullable(),
  redirectUris: z.array(nonEmptyString).min(1).optional(),
  allowedGrantTypes: z.array(applicationGrantTypeSchema).min(1).optional(),
  allowedScopes: z.array(applicationScopeSchema).min(1).optional(),
  firstParty: z.boolean().optional(),
  trusted: z.boolean().optional(),
  disabled: z.boolean().optional(),
  disabledReason: z.string().trim().max(500).nullable().optional(),
})

export const replaceRedirectUrisRequestSchema = z.object({
  redirectUris: z.array(nonEmptyString).min(1),
})

export const rotateClientSecretResponseSchema = z.object({
  clientSecret: z.string(),
  secret: applicationSecretMetadataSchema,
})

export const listApplicationsResponseSchema = z.object({
  applications: z.array(applicationResponseSchema),
  pagination: paginationMetadataSchema,
})

export const listClientSecretsResponseSchema = z.object({
  secrets: z.array(applicationSecretMetadataSchema),
  pagination: paginationMetadataSchema,
})

export const listRedirectUrisResponseSchema = z.object({
  redirectUris: z.array(z.string()),
  pagination: paginationMetadataSchema,
})

export const consentRequestQuerySchema = z.object({
  client_id: nonEmptyString,
  redirect_uri: nonEmptyString,
  scope: z.string().trim().optional(),
  state: z.string().trim().optional(),
})

export const consentRequestResponseSchema = z.object({
  application: applicationResponseSchema.omit({ secretMetadata: true }),
  requestedScopes: z.array(applicationScopeSchema),
  existingConsent: z
    .object({
      id: z.string(),
      scopes: z.array(applicationScopeSchema),
      grantedAt: z.string(),
    })
    .nullable(),
  state: z.string().nullable(),
})

export const createConsentRequestSchema = z.object({
  clientId: nonEmptyString,
  scopes: z.array(applicationScopeSchema).min(1),
  permissions: z.array(nonEmptyString).optional(),
})

export const hostedConsentApprovalRequestSchema = createConsentRequestSchema.omit({ permissions: true }).strict()

export type ApplicationResponse = z.infer<typeof applicationResponseSchema>
export type PaginationQuery = z.infer<typeof paginationQuerySchema>
export type PaginationMetadata = z.infer<typeof paginationMetadataSchema>
export type CreateApplicationRequest = z.infer<typeof createApplicationRequestSchema>
export type UpdateApplicationRequest = z.infer<typeof updateApplicationRequestSchema>
export type ReplaceRedirectUrisRequest = z.infer<typeof replaceRedirectUrisRequestSchema>
export type RotateClientSecretResponse = z.infer<typeof rotateClientSecretResponseSchema>
export type ListApplicationsResponse = z.infer<typeof listApplicationsResponseSchema>
export type ListClientSecretsResponse = z.infer<typeof listClientSecretsResponseSchema>
export type ListRedirectUrisResponse = z.infer<typeof listRedirectUrisResponseSchema>
export type ConsentRequestResponse = z.infer<typeof consentRequestResponseSchema>
export type CreateConsentRequest = z.infer<typeof createConsentRequestSchema>
export type HostedConsentApprovalRequest = z.infer<typeof hostedConsentApprovalRequestSchema>
export type ConsentApprovalResponse = {
  consent: {
    id: string
    scopes: string[]
    grantedAt: string
  }
}
