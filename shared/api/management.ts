import { z } from 'zod'
import type { AgentProtocolInventoryResponse } from './agents'
import { applicationResponseSchema, listApplicationsResponseSchema, paginationMetadataSchema } from './applications'
import { managedAssetPathSchema } from './assets'
import {
  apiResourceContractResponseSchema,
  apiResourceResponseSchema,
  listApiResourcesResponseSchema,
  listOrganizationsResponseSchema,
  listRolesResponseSchema,
  organizationResponseSchema,
  paginationQuerySchema,
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
import { adminBanUserSchema, adminCreateUserSchema, adminUpdateUserSchema, adminUserListQuerySchema } from './users'

export const managementErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum([
      'bad_request',
      'unauthorized',
      'forbidden',
      'not_found',
      'conflict',
      'resource_in_use',
      'precondition_failed',
      'precondition_required',
      'bad_gateway',
      'internal_error',
    ]),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
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
    supportUri: z.string().nullable().optional(),
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

const nullableBrandingAssetUrlSchema = z
  .union([
    managedAssetPathSchema,
    z
      .string()
      .trim()
      .url()
      .refine((value) => value.startsWith('https://'), 'URL must use https.'),
  ])
  .nullable()

const nullableEmailSchema = z.email().nullable()

export const updateManagementSignInSettingsRequestSchema = z.object({
  signIn: configzMethodSchema
    .pick({
      passwordEnabled: true,
      signupEnabled: true,
      socialLoginEnabled: true,
      usernameEnabled: true,
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
      supportUri: nullableHttpsUrlSchema,
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
      logoUrl: nullableBrandingAssetUrlSchema,
      faviconUrl: nullableBrandingAssetUrlSchema,
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

export const organizationCreationPolicySchema = z.enum(['admins_only', 'approved_users', 'verified_users'])
export const developerConsoleAccessPolicySchema = z.enum([
  'realm_operators',
  'selected_organizations',
  'all_organizations',
])
export const developerConsoleAccessLevelSchema = z.enum(['owner', 'admin', 'developer'])

export const organizationCreationPolicyResponseSchema = z.object({
  mode: organizationCreationPolicySchema,
  approvedUserIds: z
    .array(z.string())
    .default([])
    .transform((ids) => [...new Set(ids)].sort()),
})

export const replaceOrganizationCreationPolicyRequestSchema = organizationCreationPolicyResponseSchema

export const developerConsoleAccessPolicyResponseSchema = z.object({
  mode: developerConsoleAccessPolicySchema,
  eligibleAccessLevels: z.array(developerConsoleAccessLevelSchema).min(1),
  selectedOrganizationIds: z.array(z.string()),
})

export const replaceDeveloperConsoleAccessPolicyRequestSchema = developerConsoleAccessPolicyResponseSchema

export const managementRealmResponseSchema = z.object({
  id: z.literal('realm'),
  name: z.string().trim().min(1).max(80),
  issuer: z.url(),
  oidcDiscoveryUrl: z.url(),
  jwksUrl: z.url(),
  managementApiUrl: z.url(),
})

export const updateManagementRealmRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
})

export const emailDeliveryProviderSchema = z.literal('cloudflare_email')

export const emailServiceSettingsSchema = z.object({
  provider: emailDeliveryProviderSchema,
  enabled: z.boolean(),
  fromEmail: z.email(),
  fromName: z.string().trim().min(1).max(80).nullable(),
  replyToEmail: z.email().nullable(),
})

export const emailDeliveryConfigurationResponseSchema = z.object({
  provider: emailDeliveryProviderSchema,
  enabled: z.boolean(),
  fromEmail: z.email().nullable(),
  fromName: z.string().nullable(),
  replyToEmail: z.email().nullable(),
  bindingAvailable: z.boolean(),
  source: z.enum(['database', 'environment', 'unconfigured']),
})

export const replaceEmailDeliveryConfigurationRequestSchema = emailServiceSettingsSchema

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
    setupHref: z.literal('/console/applications'),
    missing: z.array(managementReadinessItemIdSchema),
  }),
})

export type ManagementAgentInventoryResponse = AgentProtocolInventoryResponse

export const managementConnectorResponseSchema = connectorResponseSchema
export const listManagementConnectorsResponseSchema = listConnectorsResponseSchema
export const createManagementConnectorRequestSchema = createConnectorRequestSchema
export const updateManagementConnectorRequestSchema = updateConnectorRequestSchema

const jwkSchema = z.record(z.string(), z.unknown())

export const managementFederatedCredentialResponseSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  name: z.string(),
  issuer: z.string(),
  subject: z.string(),
  audienceResourceId: z.string(),
  jwksUrl: z.string().nullable(),
  publicKeys: z.array(jwkSchema).nullable(),
  enabled: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const listManagementFederatedCredentialsResponseSchema = z.object({
  items: z.array(managementFederatedCredentialResponseSchema),
})

export const createManagementFederatedCredentialRequestSchema = z
  .object({
    name: z.string().trim().min(1),
    // Logical issuer identity (opaque, not dereferenced) — keep stable, not a dev URL.
    issuer: z.string().trim().min(1),
    subject: z.string().trim().min(1),
    audienceResourceId: z.string().trim().min(1),
    jwksUrl: z.url().nullable().optional(),
    publicKeys: z.array(jwkSchema).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.jwksUrl) || (value.publicKeys?.length ?? 0) > 0, {
    message: 'A federated credential requires either jwksUrl or publicKeys.',
  })

export const updateManagementFederatedCredentialRequestSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    subject: z.string().trim().min(1).optional(),
    audienceResourceId: z.string().trim().min(1).optional(),
    jwksUrl: z.url().nullable().optional(),
    publicKeys: z.array(jwkSchema).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()

export const createManagementFederatedCredentialResponseSchema = z.object({
  credential: managementFederatedCredentialResponseSchema,
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

export const managementUserSecurityStateSchema = z.object({
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
})

export const managementUserDetailResponseSchema = z.object({
  user: managementUserResponseSchema,
  security: managementUserSecurityStateSchema.optional(),
})

export const passwordResetRequestResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  status: z.literal('accepted'),
  createdAt: z.iso.datetime(),
})

export const listManagementUsersResponseSchema = z.object({
  items: z.array(managementUserResponseSchema),
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
  items: z.array(managementUserSessionSchema),
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
  items: z.array(managementUserLinkedAccountSchema),
  pagination: paginationMetadataSchema,
})

export const managementUserApplicationSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  applicationName: z.string(),
  applicationSlug: z.string(),
  scopes: z.array(z.string()),
  grantedAt: z.union([z.string(), z.date()]),
  expiresAt: z.union([z.string(), z.date()]).nullable(),
})

export const listManagementUserApplicationsResponseSchema = z.object({
  items: z.array(managementUserApplicationSchema),
  pagination: paginationMetadataSchema,
})

export const managementUserSecurityResponseSchema = z.object({
  security: managementUserSecurityStateSchema,
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
  items: z.array(managementUserPasskeySchema),
  pagination: paginationMetadataSchema,
})

export const managementResourceSchemas = {
  users: managementUserResponseSchema,
  applications: applicationResponseSchema,
  organizations: organizationResponseSchema,
  apiResources: apiResourceResponseSchema,
  apiResourceContract: apiResourceContractResponseSchema,
  roles: roleResponseSchema,
  signInSettings: managementSignInSettingsResponseSchema,
  brandingSettings: managementBrandingSettingsResponseSchema,
  readiness: managementReadinessResponseSchema,
  connectors: managementConnectorResponseSchema,
} as const

export const managementCollectionSchemas = {
  users: listManagementUsersResponseSchema,
  applications: listApplicationsResponseSchema,
  organizations: listOrganizationsResponseSchema,
  apiResources: listApiResourcesResponseSchema,
  roles: listRolesResponseSchema,
  connectors: listManagementConnectorsResponseSchema,
} as const

export const managementUserListQuerySchema = adminUserListQuerySchema
export const managementCreateUserRequestSchema = adminCreateUserSchema
export const managementUpdateUserRequestSchema = adminUpdateUserSchema
export const managementBanUserRequestSchema = adminBanUserSchema

export const protectedResourceCollectionRoutes = [
  '/applications',
  '/users',
  '/organizations',
  '/resource-servers',
  '/connectors',
  '/agents',
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
export type ManagementSignInSettingsResponse = z.infer<typeof managementSignInSettingsResponseSchema>
export type UpdateManagementSignInSettingsRequest = z.infer<typeof updateManagementSignInSettingsRequestSchema>
export type ManagementBrandingSettingsResponse = z.infer<typeof managementBrandingSettingsResponseSchema>
export type UpdateManagementBrandingSettingsRequest = z.infer<typeof updateManagementBrandingSettingsRequestSchema>
export type ManagementAccountCenterSettingsResponse = z.infer<typeof managementAccountCenterSettingsResponseSchema>
export type UpdateManagementAccountCenterSettingsRequest = z.infer<
  typeof updateManagementAccountCenterSettingsRequestSchema
>
export type OrganizationCreationPolicyResponse = z.infer<typeof organizationCreationPolicyResponseSchema>
export type ReplaceOrganizationCreationPolicyRequest = z.infer<typeof replaceOrganizationCreationPolicyRequestSchema>
export type DeveloperConsoleAccessPolicyResponse = z.infer<typeof developerConsoleAccessPolicyResponseSchema>
export type ReplaceDeveloperConsoleAccessPolicyRequest = z.infer<
  typeof replaceDeveloperConsoleAccessPolicyRequestSchema
>
export type ManagementRealmResponse = z.infer<typeof managementRealmResponseSchema>
export type UpdateManagementRealmRequest = z.infer<typeof updateManagementRealmRequestSchema>
export type EmailServiceSettings = z.infer<typeof emailServiceSettingsSchema>
export type EmailDeliveryConfigurationResponse = z.infer<typeof emailDeliveryConfigurationResponseSchema>
export type ReplaceEmailDeliveryConfigurationRequest = z.infer<typeof replaceEmailDeliveryConfigurationRequestSchema>
export type ManagementReadinessItem = z.infer<typeof managementReadinessItemSchema>
export type ManagementReadinessResponse = z.infer<typeof managementReadinessResponseSchema>
export type ManagementConnectorResponse = z.infer<typeof managementConnectorResponseSchema>
export type ListManagementConnectorsResponse = z.infer<typeof listManagementConnectorsResponseSchema>
export type CreateManagementConnectorRequest = z.infer<typeof createManagementConnectorRequestSchema>
export type UpdateManagementConnectorRequest = z.infer<typeof updateManagementConnectorRequestSchema>
export type ManagementFederatedCredentialResponse = z.infer<typeof managementFederatedCredentialResponseSchema>
export type ListManagementFederatedCredentialsResponse = z.infer<
  typeof listManagementFederatedCredentialsResponseSchema
>
export type CreateManagementFederatedCredentialRequest = z.infer<
  typeof createManagementFederatedCredentialRequestSchema
>
export type UpdateManagementFederatedCredentialRequest = z.infer<
  typeof updateManagementFederatedCredentialRequestSchema
>
export type CreateManagementFederatedCredentialResponse = z.infer<
  typeof createManagementFederatedCredentialResponseSchema
>
