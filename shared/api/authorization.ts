import { z } from 'zod'
import { paginationMetadataSchema, paginationQuerySchema } from './applications'
import { authorizationDetailsSchema } from './authorization-details'

const nonEmptyString = z.string().trim().min(1)
const rolesSchema = z
  .array(nonEmptyString)
  .min(1)
  .transform((roles) => [...new Set(roles)].sort())
const optionalText = z.string().trim().max(1000).nullable().optional()
const slugSchema = z
  .string()
  .trim()
  .min(3)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export const organizationResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  displayName: z.string().nullable(),
  logo: z.string().nullable(),
  disabled: z.boolean(),
  disabledReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const createOrganizationRequestSchema = z.object({
  slug: slugSchema,
  name: nonEmptyString,
  displayName: z.string().trim().max(200).nullable().optional(),
  logo: z
    .union([z.url(), z.string().regex(/^\/api\/assets\/[A-Za-z0-9_-]+$/)])
    .nullable()
    .optional(),
})

export const updateOrganizationRequestSchema = z.object({
  slug: slugSchema.optional(),
  name: nonEmptyString.optional(),
  displayName: z.string().trim().max(200).nullable().optional(),
  logo: z
    .union([z.url(), z.string().regex(/^\/api\/assets\/[A-Za-z0-9_-]+$/)])
    .nullable()
    .optional(),
  disabled: z.boolean().optional(),
  disabledReason: z.string().trim().max(500).nullable().optional(),
})

export const memberResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  roles: z.array(z.string()),
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const addMemberRequestSchema = z.object({
  userId: nonEmptyString,
  roles: rolesSchema.default(['member']),
  title: z.string().trim().max(200).nullable().optional(),
})

export const updateMemberRequestSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
})

export const invitationResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  email: z.email(),
  roles: z.array(z.string()),
  inviterId: z.string().nullable(),
  status: z.string(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
})

export const createInvitationRequestSchema = z.object({
  email: z.email(),
  roles: rolesSchema.default(['member']),
  expiresAt: z.iso.datetime().optional(),
})

export const apiResourceVisibilitySchema = z.enum(['private', 'public'])
export const resourceScopeGrantModeSchema = z.enum(['automatic', 'assigned'])
export const resourceScopeSchema = z
  .object({
    value: nonEmptyString,
    description: z.string().nullable(),
    grantMode: resourceScopeGrantModeSchema,
  })
  .strict()
export const resourceScopeRegistrySchema = z
  .object({
    discovery: z
      .object({
        sourceUrl: z.url(),
        etag: z.string().nullable(),
        documentHash: nonEmptyString,
        syncedAt: z.iso.datetime(),
        lastError: z
          .object({
            code: nonEmptyString,
            message: nonEmptyString,
          })
          .strict()
          .nullable(),
      })
      .strict(),
    scopes: z.array(resourceScopeSchema),
  })
  .strict()

export const apiResourceResponseSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  name: z.string(),
  resourceUrl: z.url(),
  connectorId: z.string().nullable(),
  authorizationDetails: authorizationDetailsSchema,
  description: z.string().nullable(),
  enabled: z.boolean(),
  ownerOrganizationId: z.string(),
  visibility: apiResourceVisibilitySchema,
  scopeRegistry: resourceScopeRegistrySchema.nullable(),
  availableToAgents: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const createApiResourceRequestSchema = z.object({
  identifier: nonEmptyString,
  name: nonEmptyString,
  resourceUrl: z.url(),
  connectorId: nonEmptyString.optional(),
  authorizationDetails: authorizationDetailsSchema.default([]),
  description: optionalText,
  enabled: z.boolean().optional(),
  ownerOrganizationId: nonEmptyString,
  visibility: apiResourceVisibilitySchema.optional(),
  availableToAgents: z.boolean().optional(),
})

export const updateApiResourceRequestSchema = z.object({
  identifier: nonEmptyString.optional(),
  name: nonEmptyString.optional(),
  resourceUrl: z.url().optional(),
  connectorId: nonEmptyString.nullable().optional(),
  authorizationDetails: authorizationDetailsSchema.optional(),
  description: optionalText,
  enabled: z.boolean().optional(),
  ownerOrganizationId: nonEmptyString.optional(),
  visibility: apiResourceVisibilitySchema.optional(),
  scopeGrantModes: z
    .array(z.object({ scope: nonEmptyString, grantMode: resourceScopeGrantModeSchema }).strict())
    .optional(),
  availableToAgents: z.boolean().optional(),
})

export const roleScopeSchema = z.object({
  resourceId: nonEmptyString,
  scope: nonEmptyString,
})

const roleKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/)

export const roleResponseSchema = z.object({
  key: roleKeySchema,
  displayName: nonEmptyString.max(200),
  description: z.string().nullable(),
  predefined: z.boolean(),
  scopes: z.array(roleScopeSchema),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const createRoleRequestSchema = z.object({
  key: roleKeySchema,
  displayName: nonEmptyString.max(200),
  description: optionalText,
  scopes: z.array(roleScopeSchema).default([]),
})

export const updateRoleRequestSchema = createRoleRequestSchema.omit({ key: true }).partial().strict()

export const memberRolesResponseSchema = z.object({ roles: z.array(roleKeySchema) })
export const replaceMemberRolesRequestSchema = z.object({ roles: rolesSchema })

export const listOrganizationsResponseSchema = z.object({
  organizations: z.array(organizationResponseSchema),
  pagination: paginationMetadataSchema,
})

export const listMembersResponseSchema = z.object({
  members: z.array(memberResponseSchema),
  pagination: paginationMetadataSchema,
})

export const listInvitationsResponseSchema = z.object({
  invitations: z.array(invitationResponseSchema),
  pagination: paginationMetadataSchema,
})

export const listApiResourcesResponseSchema = z.object({
  resources: z.array(apiResourceResponseSchema),
  pagination: paginationMetadataSchema,
})

export const listApiResourcesQuerySchema = paginationQuerySchema.extend({
  ownerOrganizationId: nonEmptyString.optional(),
})

export const apiResourceContractResponseSchema = z.object({
  resourceId: z.string(),
  sourceUrl: z.url(),
  scopes: z.array(
    z.object({
      value: z.string(),
      description: z.string().nullable(),
      grantMode: resourceScopeGrantModeSchema,
    }),
  ),
  operations: z.array(
    z.object({
      method: z.string(),
      path: z.string(),
      operationId: z.string().nullable(),
      summary: z.string().nullable(),
      description: z.string().nullable(),
      requiredScopeSets: z.array(z.array(z.string())),
    }),
  ),
})

const scopeGrantFieldsSchema = z.object({
  id: z.string(),
  resourceServerId: z.string(),
  scopes: z.array(nonEmptyString),
  status: z.enum(['active', 'expired']),
  grantedByUserId: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.string(),
  links: z.object({
    self: z.string(),
    resourceServer: z.string(),
  }),
})

export const userScopeGrantResponseSchema = scopeGrantFieldsSchema.extend({
  userId: z.string(),
  organizationId: z.string().nullable(),
})
export const applicationScopeGrantResponseSchema = scopeGrantFieldsSchema.extend({
  applicationId: z.string(),
})
export const createUserScopeGrantRequestSchema = z.object({
  organizationId: nonEmptyString.nullable().optional(),
  resourceServerId: nonEmptyString,
  scopes: z.array(nonEmptyString).min(1),
  expiresAt: z.iso.datetime().nullable().optional(),
})
export const createApplicationScopeGrantRequestSchema = z.object({
  resourceServerId: nonEmptyString,
  scopes: z.array(nonEmptyString).min(1),
  expiresAt: z.iso.datetime().nullable().optional(),
})
export const listScopeGrantsQuerySchema = paginationQuerySchema.extend({
  resourceServerId: nonEmptyString.optional(),
  status: z.enum(['active', 'expired']).optional(),
})
export const listUserScopeGrantsResponseSchema = z.object({
  items: z.array(userScopeGrantResponseSchema),
  pagination: paginationMetadataSchema,
})
export const listApplicationScopeGrantsResponseSchema = z.object({
  items: z.array(applicationScopeGrantResponseSchema),
  pagination: paginationMetadataSchema,
})

export const listRolesResponseSchema = z.object({
  roles: z.array(roleResponseSchema),
  pagination: paginationMetadataSchema,
})

export { paginationQuerySchema }

export type PaginationQuery = z.infer<typeof paginationQuerySchema>
export type OrganizationResponse = z.infer<typeof organizationResponseSchema>
export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequestSchema>
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequestSchema>
export type MemberResponse = z.infer<typeof memberResponseSchema>
export type AddMemberRequest = z.infer<typeof addMemberRequestSchema>
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>
export type InvitationResponse = z.infer<typeof invitationResponseSchema>
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>
export type ListMembersResponse = z.infer<typeof listMembersResponseSchema>
export type ListInvitationsResponse = z.infer<typeof listInvitationsResponseSchema>
export type ApiResourceResponse = z.infer<typeof apiResourceResponseSchema>
export type ApiResourceVisibility = z.infer<typeof apiResourceVisibilitySchema>
export type ResourceScope = z.infer<typeof resourceScopeSchema>
export type ResourceScopeRegistry = z.infer<typeof resourceScopeRegistrySchema>
export type ListApiResourcesResponse = z.infer<typeof listApiResourcesResponseSchema>
export type ListApiResourcesQuery = z.infer<typeof listApiResourcesQuerySchema>
export type ApiResourceContractResponse = z.infer<typeof apiResourceContractResponseSchema>
export type ListOrganizationsResponse = z.infer<typeof listOrganizationsResponseSchema>
export type ListRolesResponse = z.infer<typeof listRolesResponseSchema>
export type CreateApiResourceRequest = z.input<typeof createApiResourceRequestSchema>
export type UpdateApiResourceRequest = z.infer<typeof updateApiResourceRequestSchema>
export type RoleResponse = z.infer<typeof roleResponseSchema>
export type CreateRoleRequest = z.infer<typeof createRoleRequestSchema>
export type UpdateRoleRequest = z.infer<typeof updateRoleRequestSchema>
export type RoleScope = z.infer<typeof roleScopeSchema>
export type MemberRolesResponse = z.infer<typeof memberRolesResponseSchema>
export type ReplaceMemberRolesRequest = z.infer<typeof replaceMemberRolesRequestSchema>
export type UserScopeGrantResponse = z.infer<typeof userScopeGrantResponseSchema>
export type ApplicationScopeGrantResponse = z.infer<typeof applicationScopeGrantResponseSchema>
export type CreateUserScopeGrantRequest = z.infer<typeof createUserScopeGrantRequestSchema>
export type CreateApplicationScopeGrantRequest = z.infer<typeof createApplicationScopeGrantRequestSchema>
export type ListScopeGrantsQuery = z.infer<typeof listScopeGrantsQuerySchema>
