import { z } from '@hono/zod-openapi'
import type { ZodType } from 'zod'

export { z } from '@hono/zod-openapi'
export {
  agentProtocolIdentityResponseSchema,
  agentProtocolInventoryResponseSchema,
  listAgentAuditEventsResponseSchema,
  listAgentIdentityInventoryResponseSchema,
  requestAgentCapabilitiesResponseSchema,
  requestAgentCapabilitiesSchema,
} from '@shared/api/agents'
export {
  applicationResponseSchema,
  createApplicationRequestSchema,
  createApplicationResponseSchema,
  listApplicationsResponseSchema,
  listClientSecretsResponseSchema,
  listRedirectUrisResponseSchema,
  replaceRedirectUrisRequestSchema,
  rotateClientSecretResponseSchema,
  updateApplicationRequestSchema,
} from '@shared/api/applications'
export { uploadedAssetResponseSchema } from '@shared/api/assets'
export {
  addMemberRequestSchema,
  apiResourceResponseSchema,
  assignRoleRequestSchema,
  createApiResourceRequestSchema,
  createInvitationRequestSchema,
  createOrganizationRequestSchema,
  createRoleRequestSchema,
  listApiResourcesResponseSchema,
  listInvitationsResponseSchema,
  listMembersResponseSchema,
  listOrganizationsResponseSchema,
  listRolesResponseSchema,
  organizationResponseSchema,
  replaceRoleScopesRequestSchema,
  roleResponseSchema,
  roleScopesResponseSchema,
  updateApiResourceRequestSchema,
  updateMemberRequestSchema,
  updateOrganizationRequestSchema,
  updateRoleRequestSchema,
} from '@shared/api/authorization'
export { connectorReadinessResponseSchema, listConnectorTemplatesResponseSchema } from '@shared/api/connectors'
export {
  configureExternalResourceAuthorizationRequestSchema,
  externalResourceAuthorizationSchema,
} from '@shared/api/external-resources'
export {
  createManagementConnectorRequestSchema,
  createManagementFederatedCredentialRequestSchema,
  createManagementFederatedCredentialResponseSchema,
  listManagementConnectorsResponseSchema,
  listManagementFederatedCredentialsResponseSchema,
  listManagementUserApplicationsResponseSchema,
  listManagementUserLinkedAccountsResponseSchema,
  listManagementUserPasskeysResponseSchema,
  listManagementUserSessionsResponseSchema,
  listManagementUsersResponseSchema,
  managementAccountCenterSettingsResponseSchema,
  managementBanUserRequestSchema,
  managementBrandingSettingsResponseSchema,
  managementConnectorResponseSchema,
  managementCreateUserRequestSchema,
  managementErrorResponseSchema,
  managementPasswordResetRequestSchema,
  managementReadinessResponseSchema,
  managementSignInSettingsResponseSchema,
  managementUpdateUserRequestSchema,
  managementUserDetailResponseSchema,
  managementUserSecurityResponseSchema,
  paginationQuerySchema,
  updateManagementAccountCenterSettingsRequestSchema,
  updateManagementBrandingSettingsRequestSchema,
  updateManagementConnectorRequestSchema,
  updateManagementFederatedCredentialRequestSchema,
  updateManagementSignInSettingsRequestSchema,
} from '@shared/api/management'
export { securityPolicySchema, updateSecurityPolicySchema } from '@shared/api/security'
export {
  createWebhookEndpointRequestSchema,
  listWebhookEndpointsQuerySchema,
  listWebhookEndpointsResponseSchema,
  listWebhookRequestsQuerySchema,
  listWebhookRequestsResponseSchema,
  updateWebhookEndpointRequestSchema,
  webhookEndpointSchema,
  webhookEndpointSecretResponseSchema,
  webhookRequestSchema,
} from '@shared/api/webhooks'
export type { ZodType } from 'zod'

import { assignRoleRequestSchema } from '@shared/api/authorization'
import { managementErrorResponseSchema } from '@shared/api/management'

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'
export interface ManagementRouteConfig {
  method: HttpMethod
  path: string
  operationId: string
  summary: string
  cli?: {
    group: 'access' | 'auth' | 'capability'
    name: string
  }
  request?: {
    params?: ZodType
    query?: ZodType
    headers?: ZodType
    body?: { content: Record<string, { schema: ZodType }>; required?: boolean }
  }
  status?: number
  response?: ZodType
  noBody?: boolean
  errors?: Partial<Record<400 | 404 | 409, string>>
  security?: Array<Record<string, string[]>>
}
export const jsonContentType = 'application/json'
export const multipartContentType = 'multipart/form-data'
export const managementSecurity: Array<Record<string, string[]>> = [{ agentAuth: [] }, { adminSession: ['admin'] }]
export function errorResponse(description: string) {
  return { description, content: { [jsonContentType]: { schema: managementErrorResponseSchema } } }
}
export function jsonBody(schema: ZodType) {
  return { content: { [jsonContentType]: { schema } }, required: true }
}
export function multipartBody() {
  return {
    content: {
      [multipartContentType]: { schema: z.object({ file: z.string().openapi({ type: 'string', format: 'binary' }) }) },
    },
    required: true,
  }
}
export function params(...names: string[]) {
  return z.object(
    Object.fromEntries(
      names.map((name) => [name, z.string().openapi({ param: { name, in: 'path' }, example: `${name}-1` })]),
    ),
  )
}
export const idParam = params('id')
export const applicationIdParam = params('applicationId')
export const federatedCredentialParam = params('applicationId', 'credentialId')
export const organizationIdParam = params('organizationId')
export const userIdParam = params('id')
export const userSessionParam = params('id', 'sessionId')
export const userPasskeyParam = params('id', 'passkeyId')
export const memberParam = params('id', 'memberId')
export const invitationParam = params('id', 'invitationId')
export const agentIdentityParam = params('identityId')
export function assignmentRoutes(): ManagementRouteConfig[] {
  const assignments = [
    ['roles/assignments/users', 'assignUserRole'],
    ['roles/assignments/members', 'assignMemberRole'],
    ['roles/assignments/applications', 'assignApplicationRole'],
    ['roles/assignments/agents', 'assignAgentRole'],
  ] as const
  return assignments.map(([path, operationId]) => ({
    method: 'post',
    path: `/${path}`,
    operationId,
    summary: 'Assign role',
    request: { body: jsonBody(assignRoleRequestSchema) },
    response: z.object({ assignment: z.object({ id: z.string() }) }),
    status: 201,
  }))
}
