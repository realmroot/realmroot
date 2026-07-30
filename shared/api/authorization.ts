import { z } from 'zod'
import { paginationMetadataSchema, paginationQuerySchema } from './applications'

const nonEmptyString = z.string().trim().min(1)
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
  logo: z.url().nullable().optional(),
})

export const updateOrganizationRequestSchema = z.object({
  slug: slugSchema.optional(),
  name: nonEmptyString.optional(),
  displayName: z.string().trim().max(200).nullable().optional(),
  logo: z.url().nullable().optional(),
  disabled: z.boolean().optional(),
  disabledReason: z.string().trim().max(500).nullable().optional(),
})

export const memberResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  role: z.string(),
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const addMemberRequestSchema = z.object({
  userId: nonEmptyString,
  role: nonEmptyString.default('member'),
  title: z.string().trim().max(200).nullable().optional(),
})

export const updateMemberRequestSchema = z.object({
  role: nonEmptyString.optional(),
  title: z.string().trim().max(200).nullable().optional(),
})

export const invitationResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  email: z.email(),
  role: z.string(),
  inviterId: z.string().nullable(),
  status: z.string(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
})

export const createInvitationRequestSchema = z.object({
  email: z.email(),
  role: nonEmptyString.default('member'),
  expiresAt: z.iso.datetime().optional(),
})

export const apiResourceResponseSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  name: z.string(),
  resourceUrl: z.url(),
  authorizationMode: z.enum(['native', 'external']),
  description: z.string().nullable(),
  enabled: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const createApiResourceRequestSchema = z.object({
  identifier: nonEmptyString,
  name: nonEmptyString,
  resourceUrl: z.url(),
  authorizationMode: z.enum(['native', 'external']).default('native'),
  description: optionalText,
  enabled: z.boolean().optional(),
})

export const updateApiResourceRequestSchema = z.object({
  identifier: nonEmptyString.optional(),
  name: nonEmptyString.optional(),
  resourceUrl: z.url().optional(),
  description: optionalText,
  enabled: z.boolean().optional(),
})

export const roleResponseSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  resourceId: z.string().nullable(),
  organizationId: z.string().nullable(),
  applicationId: z.string().nullable(),
  system: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const createRoleRequestSchema = z.object({
  key: nonEmptyString,
  name: nonEmptyString,
  description: optionalText,
  resourceId: z.string().nullable().optional(),
  organizationId: z.string().nullable().optional(),
  applicationId: z.string().nullable().optional(),
  system: z.boolean().optional(),
})

export const updateRoleRequestSchema = createRoleRequestSchema.partial()

export const assignRoleRequestSchema = z.object({
  roleId: nonEmptyString,
  subjectId: nonEmptyString,
  expiresAt: z.iso.datetime().nullable().optional(),
})

export const replaceRoleScopesRequestSchema = z.object({
  scopes: z.array(nonEmptyString).transform((values) => [...new Set(values)].sort()),
})

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

export const listRolesResponseSchema = z.object({
  roles: z.array(roleResponseSchema),
  pagination: paginationMetadataSchema,
})

export const roleScopesResponseSchema = z.object({
  scopes: z.array(z.string()),
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
export type ApiResourceResponse = z.infer<typeof apiResourceResponseSchema>
export type ListApiResourcesResponse = z.infer<typeof listApiResourcesResponseSchema>
export type ListOrganizationsResponse = z.infer<typeof listOrganizationsResponseSchema>
export type ListRolesResponse = z.infer<typeof listRolesResponseSchema>
export type RoleScopesResponse = z.infer<typeof roleScopesResponseSchema>
export type CreateApiResourceRequest = z.input<typeof createApiResourceRequestSchema>
export type UpdateApiResourceRequest = z.infer<typeof updateApiResourceRequestSchema>
export type RoleResponse = z.infer<typeof roleResponseSchema>
export type CreateRoleRequest = z.infer<typeof createRoleRequestSchema>
export type UpdateRoleRequest = z.infer<typeof updateRoleRequestSchema>
export type AssignRoleRequest = z.infer<typeof assignRoleRequestSchema>
export type ReplaceRoleScopesRequest = z.infer<typeof replaceRoleScopesRequestSchema>
