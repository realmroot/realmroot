import { z } from 'zod'
import type { AgentProtocolInventoryResponse } from './agents'
import { applicationResponseSchema, listApplicationsResponseSchema, paginationMetadataSchema } from './applications'
import {
  apiResourceResponseSchema,
  apiScopeResponseSchema,
  listApiResourcesResponseSchema,
  listApiScopesResponseSchema,
  listOrganizationsResponseSchema,
  listRolesResponseSchema,
  organizationResponseSchema,
  paginationQuerySchema,
  rolePermissionsResponseSchema,
  roleResponseSchema,
} from './authorization'
import {
  configzAccountCenterSchema,
  configzBrandingSchema,
  configzMethodSchema,
  hostedCustomCssSchema,
} from './configz'
import {
  connectorResponseSchema,
  createConnectorRequestSchema,
  listConnectorsResponseSchema,
  updateConnectorRequestSchema,
} from './connectors'
import {
  adminBanUserSchema,
  adminCreateUserSchema,
  adminPasswordResetSchema,
  adminUpdateUserSchema,
  adminUserListQuerySchema,
} from './users'

export const managementApiBasePath = '/api/management' as const

export const managementErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum(['bad_request', 'unauthorized', 'forbidden', 'not_found', 'internal_error']),
    message: z.string(),
    requestId: z.string().optional(),
  }),
})

export const managementBuiltInProviderSettingsSchema = z.object({
  email: z.object({
    enabled: z.boolean(),
    otpLength: z.number().int().min(4).max(10),
    expiresInSeconds: z.number().int().min(30).max(3600),
  }),
  phone: z.object({
    enabled: z.boolean(),
    smsProvider: z.enum(['twilio', 'vonage', 'messagebird']),
    otpLength: z.number().int().min(4).max(10),
    expiresInSeconds: z.number().int().min(30).max(3600),
    signUpOnVerification: z.boolean(),
    requireVerification: z.boolean(),
    twilioAccountSid: z.string(),
    twilioAuthToken: z.string(),
    twilioFromNumber: z.string(),
    vonageApiKey: z.string(),
    vonageApiSecret: z.string(),
    vonageFrom: z.string(),
    messageBirdAccessKey: z.string(),
    messageBirdOriginator: z.string(),
  }),
  web3Wallet: z.object({
    enabled: z.boolean(),
    chains: z.array(z.number().int().positive()),
    domain: z.string(),
    emailDomainName: z.string(),
    allowSignUp: z.boolean(),
    ensLookupEnabled: z.boolean(),
  }),
  passkey: z.object({
    allowSignUp: z.boolean(),
  }),
  oneTap: z.object({
    enabled: z.boolean(),
    clientId: z.string(),
    autoSelect: z.boolean(),
    cancelOnTapOutside: z.boolean(),
    uxMode: z.enum(['popup', 'redirect']),
    context: z.enum(['signin', 'signup', 'use']),
    promptBaseDelayMs: z.number().int().min(0).max(60000),
    promptMaxAttempts: z.number().int().min(1).max(20),
    disableSignUp: z.boolean(),
  }),
})

export const managementSignInSettingsResponseSchema = z.object({
  signIn: configzMethodSchema,
  builtInProviders: managementBuiltInProviderSettingsSchema,
  links: z.object({
    termsUri: z.string().nullable(),
    privacyUri: z.string().nullable(),
    supportEmail: z.string().nullable(),
  }),
  copy: z.object({
    productName: z.string(),
    headline: z.string(),
    description: z.string(),
  }),
})

const nullableHttpsUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => value.startsWith('https://'), 'URL must use https.')
  .nullable()

const nullableEmailSchema = z.email().nullable()

export const updateManagementSignInSettingsRequestSchema = z.object({
  signIn: configzMethodSchema
    .pick({
      passwordEnabled: true,
      signupEnabled: true,
      socialLoginEnabled: true,
      identifierFirst: true,
      emailOtpEnabled: true,
    })
    .partial()
    .optional(),
  builtInProviders: z
    .object({
      email: managementBuiltInProviderSettingsSchema.shape.email.partial(),
      phone: managementBuiltInProviderSettingsSchema.shape.phone.partial(),
      web3Wallet: managementBuiltInProviderSettingsSchema.shape.web3Wallet.partial(),
      passkey: managementBuiltInProviderSettingsSchema.shape.passkey.partial(),
      oneTap: managementBuiltInProviderSettingsSchema.shape.oneTap.partial(),
    })
    .partial()
    .optional(),
  links: z
    .object({
      termsUri: nullableHttpsUrlSchema,
      privacyUri: nullableHttpsUrlSchema,
      supportEmail: nullableEmailSchema,
    })
    .partial()
    .optional(),
  copy: z
    .object({
      productName: z.string().trim().min(1).max(80),
      headline: z.string().trim().min(1).max(120),
      description: z.string().trim().min(1).max(240),
    })
    .partial()
    .optional(),
})

export const managementBrandingSettingsResponseSchema = z.object({
  branding: configzBrandingSchema,
  copy: managementSignInSettingsResponseSchema.shape.copy,
})

export const updateManagementBrandingSettingsRequestSchema = z.object({
  branding: z
    .object({
      logoUrl: nullableHttpsUrlSchema,
      faviconUrl: nullableHttpsUrlSchema,
      primaryColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .nullable(),
      backgroundColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .nullable(),
      customCss: hostedCustomCssSchema.nullable(),
    })
    .partial()
    .optional(),
  copy: updateManagementSignInSettingsRequestSchema.shape.copy,
})

export const managementAccountCenterSettingsResponseSchema = z.object({
  accountCenter: configzAccountCenterSchema,
})

export const updateManagementAccountCenterSettingsRequestSchema = z.object({
  accountCenter: configzAccountCenterSchema.partial(),
})

export const managementReadinessItemIdSchema = z.enum([
  'oidc_application',
  'email_delivery',
  'branding_basics',
  'sign_in_method',
  'security_baseline',
  'connector_status',
])

export const managementReadinessItemStatusSchema = z.enum(['complete', 'action_needed'])

export const managementReadinessItemSchema = z.object({
  id: managementReadinessItemIdSchema,
  label: z.string(),
  description: z.string(),
  status: managementReadinessItemStatusSchema,
  href: z.string(),
  action: z.string(),
})

export const managementReadinessResponseSchema = z.object({
  required: z.array(managementReadinessItemSchema),
  recommended: z.array(managementReadinessItemSchema),
  admin: z.object({
    setupRequired: z.boolean(),
    setupHref: z.literal('/console/onboarding'),
    missing: z.array(managementReadinessItemIdSchema),
  }),
})

export type ManagementAgentInventoryResponse = AgentProtocolInventoryResponse

export const managementConnectorResponseSchema = connectorResponseSchema
export const listManagementConnectorsResponseSchema = listConnectorsResponseSchema
export const createManagementConnectorRequestSchema = createConnectorRequestSchema
export const updateManagementConnectorRequestSchema = updateConnectorRequestSchema

export const managementTrustedIssuerResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  issuer: z.string(),
  jwksUrl: z.string().nullable(),
  sharedSecretConfigured: z.boolean(),
  allowedAudiences: z.array(z.string()),
  enabled: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const listManagementTrustedIssuersResponseSchema = z.object({
  issuers: z.array(managementTrustedIssuerResponseSchema),
})

export const createManagementTrustedIssuerRequestSchema = z
  .object({
    name: z.string().trim().min(1),
    issuer: z.url(),
    jwksUrl: z.url().nullable().optional(),
    sharedSecret: z.string().trim().min(16).nullable().optional(),
    allowedAudiences: z.array(z.string().trim().min(1)).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict()

export const createManagementTrustedIssuerResponseSchema = z.object({
  issuer: managementTrustedIssuerResponseSchema,
})

export const managementUserResponseSchema = z.object({
  id: z.string(),
  email: z.string().optional(),
  emailVerified: z.boolean().optional(),
  name: z.string().optional(),
  displayName: z.string().optional(),
  username: z.string().nullable().optional(),
  avatarAssetId: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  role: z
    .union([z.string(), z.array(z.string())])
    .nullable()
    .optional(),
  banned: z.boolean().nullable().optional(),
  banReason: z.string().nullable().optional(),
  banExpires: z.union([z.string(), z.date()]).nullable().optional(),
  createdAt: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).optional(),
})

export const managementUserDetailResponseSchema = z.object({
  user: managementUserResponseSchema,
})

export const listManagementUsersResponseSchema = z.object({
  users: z.array(managementUserResponseSchema),
  pagination: paginationMetadataSchema,
})

export const managementUserSessionSchema = z.object({
  id: z.string(),
  expiresAt: z.union([z.string(), z.date()]),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]).optional(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  activeOrganizationId: z.string().nullable().optional(),
  impersonatedBy: z.string().nullable().optional(),
})

export const listManagementUserSessionsResponseSchema = z.object({
  sessions: z.array(managementUserSessionSchema),
  pagination: paginationMetadataSchema,
})

export const managementUserLinkedAccountSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  providerId: z.string(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]).optional(),
})

export const listManagementUserLinkedAccountsResponseSchema = z.object({
  accounts: z.array(managementUserLinkedAccountSchema),
  pagination: paginationMetadataSchema,
})

export const managementUserApplicationSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  applicationName: z.string(),
  applicationSlug: z.string(),
  scopes: z.array(z.string()),
  permissions: z.array(z.string()).nullable().optional(),
  grantedAt: z.union([z.string(), z.date()]),
  expiresAt: z.union([z.string(), z.date()]).nullable(),
})

export const listManagementUserApplicationsResponseSchema = z.object({
  applications: z.array(managementUserApplicationSchema),
  pagination: paginationMetadataSchema,
})

export const managementUserSecurityResponseSchema = z.object({
  security: z.object({
    userId: z.string(),
    mfa: z.object({
      enabled: z.boolean(),
      factors: z.array(z.object({ id: z.string(), type: z.string(), verified: z.boolean().nullable() })),
    }),
    passkeys: z.object({
      enabled: z.boolean(),
      count: z.number().int().min(0),
    }),
    policy: z.object({
      mfa: z.object({ mode: z.enum(['optional', 'required']) }),
      passkeys: z.object({ enabled: z.boolean(), rpName: z.string() }).passthrough(),
    }),
  }),
})

export const managementUserPasskeySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  userId: z.string().optional(),
  deviceType: z.string(),
  backedUp: z.boolean(),
  transports: z.string().nullable().optional(),
  createdAt: z.union([z.string(), z.date()]).nullable(),
  aaguid: z.string().nullable().optional(),
})

export const listManagementUserPasskeysResponseSchema = z.object({
  passkeys: z.array(managementUserPasskeySchema),
  pagination: paginationMetadataSchema,
})

export const managementResourceSchemas = {
  users: managementUserResponseSchema,
  applications: applicationResponseSchema,
  organizations: organizationResponseSchema,
  apiResources: apiResourceResponseSchema,
  apiScopes: apiScopeResponseSchema,
  rolePermissions: rolePermissionsResponseSchema,
  roles: roleResponseSchema,
  signInSettings: managementSignInSettingsResponseSchema,
  brandingSettings: managementBrandingSettingsResponseSchema,
  readiness: managementReadinessResponseSchema,
  connectors: managementConnectorResponseSchema,
  trustedIssuers: managementTrustedIssuerResponseSchema,
} as const

export const managementCollectionSchemas = {
  users: listManagementUsersResponseSchema,
  applications: listApplicationsResponseSchema,
  organizations: listOrganizationsResponseSchema,
  apiResources: listApiResourcesResponseSchema,
  apiScopes: listApiScopesResponseSchema,
  roles: listRolesResponseSchema,
  connectors: listManagementConnectorsResponseSchema,
  trustedIssuers: listManagementTrustedIssuersResponseSchema,
} as const

export const managementUserListQuerySchema = adminUserListQuerySchema
export const managementCreateUserRequestSchema = adminCreateUserSchema
export const managementUpdateUserRequestSchema = adminUpdateUserSchema
export const managementBanUserRequestSchema = adminBanUserSchema
export const managementPasswordResetRequestSchema = adminPasswordResetSchema

export const managementCollectionRoutes = [
  '/applications',
  '/users',
  '/organizations',
  '/roles',
  '/api-resources',
  '/connectors',
  '/trusted-issuers',
] as const

export { paginationQuerySchema }

export type ManagementErrorResponse = z.infer<typeof managementErrorResponseSchema>
export type ManagementUserResponse = z.infer<typeof managementUserResponseSchema>
export type ManagementUserDetailResponse = z.infer<typeof managementUserDetailResponseSchema>
export type ListManagementUsersResponse = z.infer<typeof listManagementUsersResponseSchema>
export type ListManagementUserSessionsResponse = z.infer<typeof listManagementUserSessionsResponseSchema>
export type ListManagementUserLinkedAccountsResponse = z.infer<typeof listManagementUserLinkedAccountsResponseSchema>
export type ListManagementUserApplicationsResponse = z.infer<typeof listManagementUserApplicationsResponseSchema>
export type ManagementUserSecurityResponse = z.infer<typeof managementUserSecurityResponseSchema>
export type ListManagementUserPasskeysResponse = z.infer<typeof listManagementUserPasskeysResponseSchema>
export type ManagementUserListQuery = z.infer<typeof managementUserListQuerySchema>
export type ManagementCreateUserRequest = z.infer<typeof managementCreateUserRequestSchema>
export type ManagementUpdateUserRequest = z.infer<typeof managementUpdateUserRequestSchema>
export type ManagementBanUserRequest = z.infer<typeof managementBanUserRequestSchema>
export type ManagementPasswordResetRequest = z.infer<typeof managementPasswordResetRequestSchema>
export type ManagementSignInSettingsResponse = z.infer<typeof managementSignInSettingsResponseSchema>
export type UpdateManagementSignInSettingsRequest = z.infer<typeof updateManagementSignInSettingsRequestSchema>
export type ManagementBrandingSettingsResponse = z.infer<typeof managementBrandingSettingsResponseSchema>
export type UpdateManagementBrandingSettingsRequest = z.infer<typeof updateManagementBrandingSettingsRequestSchema>
export type ManagementAccountCenterSettingsResponse = z.infer<typeof managementAccountCenterSettingsResponseSchema>
export type UpdateManagementAccountCenterSettingsRequest = z.infer<
  typeof updateManagementAccountCenterSettingsRequestSchema
>
export type ManagementReadinessItem = z.infer<typeof managementReadinessItemSchema>
export type ManagementReadinessResponse = z.infer<typeof managementReadinessResponseSchema>
export type ManagementConnectorResponse = z.infer<typeof managementConnectorResponseSchema>
export type ListManagementConnectorsResponse = z.infer<typeof listManagementConnectorsResponseSchema>
export type CreateManagementConnectorRequest = z.infer<typeof createManagementConnectorRequestSchema>
export type UpdateManagementConnectorRequest = z.infer<typeof updateManagementConnectorRequestSchema>
export type ManagementTrustedIssuerResponse = z.infer<typeof managementTrustedIssuerResponseSchema>
export type ListManagementTrustedIssuersResponse = z.infer<typeof listManagementTrustedIssuersResponseSchema>
export type CreateManagementTrustedIssuerRequest = z.infer<typeof createManagementTrustedIssuerRequestSchema>
export type CreateManagementTrustedIssuerResponse = z.infer<typeof createManagementTrustedIssuerResponseSchema>
