import { z } from 'zod'
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
  roleResponseSchema,
} from './authorization'
import { configzBrandingSchema, configzMethodSchema, hostedCustomCssSchema } from './configz'
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

export const managementSignInSettingsResponseSchema = z.object({
  signIn: configzMethodSchema,
  defaults: z.object({
    applicationId: z.string().nullable(),
    redirectUri: z.string().nullable(),
  }),
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
    })
    .partial()
    .optional(),
  defaults: z
    .object({
      applicationId: z.string().trim().min(1).nullable(),
      redirectUri: nullableHttpsUrlSchema,
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

export const managementReadinessResponseSchema = z.object({
  admin: z.object({
    setupRequired: z.boolean(),
    setupHref: z.literal('/admin/onboarding'),
    missing: z.array(z.enum(['oidc_application'])),
  }),
})

export const managementConnectorResponseSchema = connectorResponseSchema
export const listManagementConnectorsResponseSchema = listConnectorsResponseSchema
export const createManagementConnectorRequestSchema = createConnectorRequestSchema
export const updateManagementConnectorRequestSchema = updateConnectorRequestSchema

export const managementUserResponseSchema = z
  .object({
    id: z.string(),
    email: z.string().optional(),
    name: z.string().optional(),
    role: z
      .union([z.string(), z.array(z.string())])
      .nullable()
      .optional(),
    banned: z.boolean().nullable().optional(),
    createdAt: z.union([z.string(), z.date()]).optional(),
    updatedAt: z.union([z.string(), z.date()]).optional(),
  })
  .passthrough()

export const listManagementUsersResponseSchema = z.object({
  users: z.array(managementUserResponseSchema),
  pagination: paginationMetadataSchema,
})

export const managementResourceSchemas = {
  users: managementUserResponseSchema,
  applications: applicationResponseSchema,
  organizations: organizationResponseSchema,
  apiResources: apiResourceResponseSchema,
  apiScopes: apiScopeResponseSchema,
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
  apiScopes: listApiScopesResponseSchema,
  roles: listRolesResponseSchema,
  connectors: listManagementConnectorsResponseSchema,
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
] as const

export { paginationQuerySchema }

export type ManagementErrorResponse = z.infer<typeof managementErrorResponseSchema>
export type ManagementUserResponse = z.infer<typeof managementUserResponseSchema>
export type ListManagementUsersResponse = z.infer<typeof listManagementUsersResponseSchema>
export type ManagementUserListQuery = z.infer<typeof managementUserListQuerySchema>
export type ManagementCreateUserRequest = z.infer<typeof managementCreateUserRequestSchema>
export type ManagementUpdateUserRequest = z.infer<typeof managementUpdateUserRequestSchema>
export type ManagementBanUserRequest = z.infer<typeof managementBanUserRequestSchema>
export type ManagementPasswordResetRequest = z.infer<typeof managementPasswordResetRequestSchema>
export type ManagementSignInSettingsResponse = z.infer<typeof managementSignInSettingsResponseSchema>
export type UpdateManagementSignInSettingsRequest = z.infer<typeof updateManagementSignInSettingsRequestSchema>
export type ManagementBrandingSettingsResponse = z.infer<typeof managementBrandingSettingsResponseSchema>
export type UpdateManagementBrandingSettingsRequest = z.infer<typeof updateManagementBrandingSettingsRequestSchema>
export type ManagementReadinessResponse = z.infer<typeof managementReadinessResponseSchema>
export type ManagementConnectorResponse = z.infer<typeof managementConnectorResponseSchema>
export type ListManagementConnectorsResponse = z.infer<typeof listManagementConnectorsResponseSchema>
export type CreateManagementConnectorRequest = z.infer<typeof createManagementConnectorRequestSchema>
export type UpdateManagementConnectorRequest = z.infer<typeof updateManagementConnectorRequestSchema>
