import { z } from 'zod'
import { paginationMetadataSchema, paginationQuerySchema } from './pagination'

export const applicationClientTypes = ['public_spa', 'public_native', 'confidential_web', 'machine'] as const
export const deviceCodeGrantType = 'urn:ietf:params:oauth:grant-type:device_code'
export const tokenExchangeGrantType = 'urn:ietf:params:oauth:grant-type:token-exchange'
export const applicationGrantTypes = [
  'authorization_code',
  'refresh_token',
  'client_credentials',
  deviceCodeGrantType,
  tokenExchangeGrantType,
] as const
export const userConfigurableApplicationScopes = ['openid', 'profile', 'email', 'offline_access'] as const
export const applicationScopes = userConfigurableApplicationScopes

export const applicationClientTypeSchema = z.enum(applicationClientTypes)
export const applicationGrantTypeSchema = z.enum(applicationGrantTypes)
export const applicationScopeSchema = z.enum(applicationScopes)
export const userConfigurableApplicationScopeSchema = applicationScopeSchema

const nonEmptyString = z.string().trim().min(1)
const managedAssetUrlSchema = z.union([z.url(), z.string().regex(/^\/api\/assets\/[A-Za-z0-9_-]+$/)])
const optionalUrl = managedAssetUrlSchema.optional()
const customDataSchema = z.record(z.string(), z.unknown())
const maxScopesPerApplicationResource = 1_000

export const applicationResourceScopesSchema = z
  .array(
    z
      .object({
        resourceServerId: nonEmptyString.max(200),
        scopes: z
          .array(nonEmptyString.max(200))
          .max(maxScopesPerApplicationResource)
          .transform((scopes) => [...new Set(scopes)].sort()),
      })
      .strict(),
  )
  .max(100)

// Re-exported from the canonical pagination module so existing
// `@shared/api/applications` import sites keep working.
export { paginationMetadataSchema, paginationQuerySchema }
export const listApplicationsQuerySchema = paginationQuerySchema.extend({
  ownerOrganizationId: nonEmptyString.optional(),
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
  deviceAuthorizationEndpoint: z.string().optional(),
  tokenEndpoint: z.string(),
  jwksUri: z.string(),
  userInfoEndpoint: z.string(),
  endSessionEndpoint: z.string(),
})

const oidcClaimSelectionSchema = z
  .object({
    authorization: z.boolean().optional(),
    scopes: z.boolean().optional(),
    groups: z.boolean().optional(),
    roles: z.boolean().optional(),
    organizationId: z.boolean().optional(),
    organizationName: z.boolean().optional(),
  })
  .strict()

export const applicationOidcClaimsSchema = z
  .object({
    accessToken: oidcClaimSelectionSchema,
    idToken: oidcClaimSelectionSchema,
    userInfo: oidcClaimSelectionSchema,
  })
  .strict()

export const defaultApplicationOidcClaims = {
  accessToken: {
    groups: true,
    roles: true,
  },
  idToken: {},
  userInfo: {},
}

export const applicationResponseSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    homepageUrl: z.string().nullable(),
    iconUrl: z.string().nullable(),
    clientId: z.string(),
    clientType: applicationClientTypeSchema,
    public: z.boolean(),
    consentRequired: z.boolean(),
    disabled: z.boolean(),
    disabledReason: z.string().nullable(),
    ownerOrganizationId: z.string(),
    redirectUris: z.array(z.string()),
    postLogoutRedirectUris: z.array(z.string()),
    corsOrigins: z.array(z.string()),
    customData: customDataSchema,
    allowedGrantTypes: z.array(applicationGrantTypeSchema),
    oidcScopes: z.array(applicationScopeSchema),
    resourceScopes: applicationResourceScopesSchema,
    /** @deprecated Realmroot uses one platform token profile. This value is fixed and input is ignored. */
    oidcClaims: applicationOidcClaimsSchema.optional(),
    requirePkce: z.boolean(),
    tokenEndpointAuthMethod: z.enum(['none', 'client_secret_basic', 'client_secret_post']),
    secretMetadata: z.array(applicationSecretMetadataSchema),
    oidc: oidcEndpointMetadataSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()

export const createApplicationResponseSchema = applicationResponseSchema.extend({
  clientSecret: z.string().optional(),
})

export const createApplicationRequestSchema = z
  .object({
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
    redirectUris: z.array(nonEmptyString).default([]),
    postLogoutRedirectUris: z.array(nonEmptyString).optional(),
    corsOrigins: z.array(nonEmptyString).optional(),
    resourceScopes: applicationResourceScopesSchema.optional(),
    consentRequired: z.boolean().optional(),
    ownerOrganizationId: nonEmptyString,
    deviceLoginEnabled: z.boolean().optional(),
    /** @deprecated Accepted for migration compatibility and ignored. */
    oidcClaims: applicationOidcClaimsSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.deviceLoginEnabled && input.clientType !== 'public_native') {
      context.addIssue({
        code: 'custom',
        path: ['deviceLoginEnabled'],
        message: 'Device login is available only for public native clients.',
      })
    }
    if (input.clientType !== 'machine' && !input.redirectUris.length) {
      context.addIssue({
        code: 'custom',
        path: ['redirectUris'],
        message: 'Authorization-code clients require at least one redirect URI.',
      })
    }
    if (input.clientType === 'machine' && input.redirectUris.length) {
      context.addIssue({
        code: 'custom',
        path: ['redirectUris'],
        message: 'Machine Applications do not use redirect URIs.',
      })
    }
  })

export const updateApplicationRequestSchema = z
  .object({
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
    redirectUris: z.array(nonEmptyString).optional(),
    postLogoutRedirectUris: z.array(nonEmptyString).optional(),
    corsOrigins: z.array(nonEmptyString).optional(),
    customData: customDataSchema.optional(),
    resourceScopes: applicationResourceScopesSchema.optional(),
    consentRequired: z.boolean().optional(),
    disabled: z.boolean().optional(),
    disabledReason: z.string().trim().max(500).nullable().optional(),
    ownerOrganizationId: nonEmptyString.optional(),
    deviceLoginEnabled: z.boolean().optional(),
    /** @deprecated Accepted for migration compatibility and ignored. */
    oidcClaims: applicationOidcClaimsSchema.optional(),
  })
  .strict()

export const replaceRedirectUrisRequestSchema = z.object({
  redirectUris: z.array(nonEmptyString),
})

export const rotateClientSecretResponseSchema = z.object({
  clientSecret: z.string(),
  secret: applicationSecretMetadataSchema,
})

export const listApplicationsResponseSchema = z.object({
  items: z.array(applicationResponseSchema),
  pagination: paginationMetadataSchema,
})

export const listClientSecretsResponseSchema = z.object({
  items: z.array(applicationSecretMetadataSchema),
  pagination: paginationMetadataSchema,
})

export const applicationAuthorizationSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  application: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  }),
  user: z.object({
    id: z.string(),
    displayName: z.string(),
    email: z.email(),
  }),
  resourceServerId: z.string().nullable(),
  scopes: z.array(z.string()),
  authorizationSource: z.enum(['user_consent', 'platform_policy']),
  grantedAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  status: z.enum(['active', 'expired', 'revoked']),
})

export const listApplicationAuthorizationsQuerySchema = paginationQuerySchema.extend({
  applicationId: nonEmptyString.optional(),
  userId: nonEmptyString.optional(),
  status: z.enum(['active', 'expired', 'revoked']).optional(),
})

export const listApplicationAuthorizationsResponseSchema = z.object({
  items: z.array(applicationAuthorizationSchema),
  pagination: paginationMetadataSchema,
})

export const applicationAuthorizationRevocationSchema = z.object({
  applicationAuthorizationId: z.string(),
  revokedAt: z.string(),
})

export const listRedirectUrisResponseSchema = z.object({
  items: z.array(z.string()),
  pagination: paginationMetadataSchema,
})

export const consentRequestQuerySchema = z.object({
  client_id: nonEmptyString,
  redirect_uri: nonEmptyString,
  scope: z.string().trim().optional(),
  state: z.string().trim().optional(),
})

const consentPermissionSchema = z.object({
  value: z.string(),
  description: z.string().nullable(),
})

const existingConsentSchema = z
  .object({
    id: z.string(),
    scopes: z.array(z.string()),
    grantedAt: z.string(),
  })
  .nullable()

export const consentResourceAuthorizationSchema = z.object({
  resourceServerId: z.string().nullable(),
  resourceUrl: z.url().nullable(),
  resourceName: z.string(),
  requestedScopes: z.array(z.string()),
  requestedPermissions: z.array(consentPermissionSchema),
  addedScopes: z.array(z.string()),
  previouslyApprovedScopes: z.array(z.string()),
  consentReason: z.enum(['initial', 'expanded', 'reauthorization']),
  existingConsent: existingConsentSchema,
})

export const consentRequestResponseSchema = z.object({
  application: applicationResponseSchema.omit({ secretMetadata: true }),
  user: z.object({
    email: z.email().nullable(),
    displayName: z.string().nullable(),
    image: z.string().nullable(),
  }),
  redirects: z.object({
    approveUrl: z.string(),
    denyUrl: z.string(),
  }),
  resourceServerId: z.string().nullable(),
  requestedScopes: z.array(z.string()),
  requestedPermissions: z.array(consentPermissionSchema),
  addedScopes: z.array(z.string()),
  previouslyApprovedScopes: z.array(z.string()),
  consentReason: z.enum(['initial', 'expanded', 'reauthorization']),
  existingConsent: existingConsentSchema,
  resourceAuthorizations: z.array(consentResourceAuthorizationSchema).min(1).optional(),
  state: z.string().nullable(),
})

export const createConsentRequestSchema = z
  .object({
    clientId: nonEmptyString,
    resourceServerId: nonEmptyString.nullable(),
    scopes: z.array(nonEmptyString).min(1),
  })
  .strict()

export const hostedConsentApprovalRequestSchema = createConsentRequestSchema

export const consentApprovalResponseSchema = z.object({
  consent: z.object({
    id: z.string(),
    scopes: z.array(z.string()),
    grantedAt: z.string(),
  }),
})

export type ApplicationResponse = z.infer<typeof applicationResponseSchema>
export type ApplicationOidcClaims = z.infer<typeof applicationOidcClaimsSchema>
export type CreateApplicationResponse = z.infer<typeof createApplicationResponseSchema>
export type PaginationQuery = z.infer<typeof paginationQuerySchema>
export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>
export type PaginationMetadata = z.infer<typeof paginationMetadataSchema>
export type CreateApplicationRequest = z.infer<typeof createApplicationRequestSchema>
export type UpdateApplicationRequest = z.infer<typeof updateApplicationRequestSchema>
export type ReplaceRedirectUrisRequest = z.infer<typeof replaceRedirectUrisRequestSchema>
export type RotateClientSecretResponse = z.infer<typeof rotateClientSecretResponseSchema>
export type ListApplicationsResponse = z.infer<typeof listApplicationsResponseSchema>
export type ListClientSecretsResponse = z.infer<typeof listClientSecretsResponseSchema>
export type ListRedirectUrisResponse = z.infer<typeof listRedirectUrisResponseSchema>
export type ApplicationAuthorization = z.infer<typeof applicationAuthorizationSchema>
export type ListApplicationAuthorizationsQuery = z.infer<typeof listApplicationAuthorizationsQuerySchema>
export type ListApplicationAuthorizationsResponse = z.infer<typeof listApplicationAuthorizationsResponseSchema>
export type ApplicationAuthorizationRevocation = z.infer<typeof applicationAuthorizationRevocationSchema>
export type ConsentRequestResponse = z.infer<typeof consentRequestResponseSchema>
export type CreateConsentRequest = z.infer<typeof createConsentRequestSchema>
export type HostedConsentApprovalRequest = z.infer<typeof hostedConsentApprovalRequestSchema>
export type ConsentApprovalResponse = z.infer<typeof consentApprovalResponseSchema>
