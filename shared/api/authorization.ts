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
export const apiResourceAccessModeSchema = z.enum(['realmroot', 'external_oauth', 'brokered'])
export const resourceScopeGrantModeSchema = z.enum(['automatic', 'assigned'])
export const resourceScopeSchema = z
  .object({
    value: nonEmptyString,
    description: z.string().nullable(),
    grantMode: resourceScopeGrantModeSchema,
  })
  .strict()
export const brokeredAccountConnectionSchema = z
  .object({
    mode: z.literal('brokered'),
    authorizationEndpoint: z.url(),
    tokenEndpoint: z.url(),
    revocationEndpoint: z.url().nullable().optional(),
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
    accountConnection: brokeredAccountConnectionSchema.nullable().optional(),
  })
  .strict()

export const apiResourceResponseSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  name: z.string(),
  resourceUrl: z.url(),
  accessMode: apiResourceAccessModeSchema,
  connectorId: z.string().nullable(),
  authorizationDetails: authorizationDetailsSchema,
  description: z.string().nullable(),
  enabled: z.boolean(),
  ownerOrganizationId: z.string(),
  visibility: apiResourceVisibilitySchema,
  scopeRegistry: resourceScopeRegistrySchema.nullable(),
  availableToAgents: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const createApiResourceRequestSchema = z
  .object({
    identifier: nonEmptyString,
    resourceUrl: z.url(),
    accessMode: apiResourceAccessModeSchema,
    connectorId: nonEmptyString.optional(),
    authorizationDetails: authorizationDetailsSchema.default([]),
    enabled: z.boolean().optional(),
    ownerOrganizationId: nonEmptyString,
    visibility: apiResourceVisibilitySchema.optional(),
    availableToAgents: z.boolean().optional(),
  })
  .strict()

export const updateApiResourceRequestSchema = z
  .object({
    identifier: nonEmptyString.optional(),
    resourceUrl: z.url().optional(),
    authorizationDetails: authorizationDetailsSchema.optional(),
    enabled: z.boolean().optional(),
    ownerOrganizationId: nonEmptyString.optional(),
    visibility: apiResourceVisibilitySchema.optional(),
    scopeGrantModes: z
      .array(z.object({ scope: nonEmptyString, grantMode: resourceScopeGrantModeSchema }).strict())
      .optional(),
    availableToAgents: z.boolean().optional(),
  })
  .strict()

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

export const permissionResponseSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  applicationId: z.string().nullable(),
  agentIdentityId: z.string().nullable(),
  organizationId: z.string().nullable(),
  resourceServerId: z.string(),
  connectionId: z.string().nullable(),
  authorizationDetails: authorizationDetailsSchema,
  scope: nonEmptyString,
  mode: z.enum(['persistent', 'until', 'once']),
  status: z.enum(['active', 'ended']),
  grantedBy: z.discriminatedUnion('type', [
    z.object({ type: z.literal('user'), id: z.string() }),
    z.object({ type: z.literal('agent'), id: z.string() }),
  ]),
  sourceAccessRequestId: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  endReason: z.enum(['revoked', 'consumed', 'expired', 'merged']).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  links: z.object({
    self: z.string(),
    resourceServer: z.string(),
  }),
})

export const createUserPermissionRequestSchema = z.object({
  organizationId: nonEmptyString.nullable().optional(),
  resourceServerId: nonEmptyString,
  scope: nonEmptyString,
  mode: z.enum(['persistent', 'until']).default('persistent'),
  expiresAt: z.iso.datetime().nullable().optional(),
})
export const createApplicationPermissionRequestSchema = z.object({
  resourceServerId: nonEmptyString,
  scope: nonEmptyString,
  mode: z.enum(['persistent', 'until']).default('persistent'),
  expiresAt: z.iso.datetime().nullable().optional(),
})
export const permissionListStatusSchema = z.enum(['active', 'inactive'])
export const listPermissionsQuerySchema = paginationQuerySchema.extend({
  resourceServerId: nonEmptyString.optional(),
  status: permissionListStatusSchema.optional(),
})
export const listUserPermissionsResponseSchema = z.object({
  items: z.array(permissionResponseSchema),
  pagination: paginationMetadataSchema,
})
export const listApplicationPermissionsResponseSchema = z.object({
  items: z.array(permissionResponseSchema),
  pagination: paginationMetadataSchema,
})

export const authorizedResourceServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  identifier: z.string(),
  permissionCount: z.number().int().positive(),
})
export const listAuthorizedResourceServersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(200).optional(),
})
export const listAuthorizedResourceServersResponseSchema = z.object({
  items: z.array(authorizedResourceServerSchema),
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
export type ApiResourceAccessMode = z.infer<typeof apiResourceAccessModeSchema>
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
export type PermissionResponse = z.infer<typeof permissionResponseSchema>
export type CreateUserPermissionRequest = z.infer<typeof createUserPermissionRequestSchema>
export type CreateApplicationPermissionRequest = z.infer<typeof createApplicationPermissionRequestSchema>
export type ListPermissionsQuery = z.infer<typeof listPermissionsQuerySchema>
export type AuthorizedResourceServer = z.infer<typeof authorizedResourceServerSchema>
export type ListAuthorizedResourceServersQuery = z.infer<typeof listAuthorizedResourceServersQuerySchema>
