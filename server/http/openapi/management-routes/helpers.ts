import { z } from '@hono/zod-openapi'
import { idempotencyKeySchema } from '@shared/api/idempotency'
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
  applicationAuthorizationRevocationSchema,
  applicationAuthorizationSchema,
  applicationResponseSchema,
  createApplicationRequestSchema,
  createApplicationResponseSchema,
  listApplicationAuthorizationsQuerySchema,
  listApplicationAuthorizationsResponseSchema,
  listApplicationsQuerySchema,
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
  createApiResourceRequestSchema,
  createInvitationRequestSchema,
  createOrganizationRequestSchema,
  createRoleAssignmentRequestSchema,
  createRoleRequestSchema,
  invitationResponseSchema,
  listApiResourcesQuerySchema,
  listApiResourcesResponseSchema,
  listInvitationsResponseSchema,
  listMembersResponseSchema,
  listOrganizationsResponseSchema,
  listRoleAssignmentsQuerySchema,
  listRoleAssignmentsResponseSchema,
  listRolesResponseSchema,
  memberResponseSchema,
  organizationResponseSchema,
  replaceRolePermissionsRequestSchema,
  roleAssignmentResponseSchema,
  roleAssignmentRevocationSchema,
  rolePermissionsResponseSchema,
  roleResponseSchema,
  updateApiResourceRequestSchema,
  updateMemberRequestSchema,
  updateOrganizationRequestSchema,
  updateRoleRequestSchema,
} from '@shared/api/authorization'
export { connectorReadinessResponseSchema, listConnectorTemplatesResponseSchema } from '@shared/api/connectors'
export { externalResourceAuthorizationSchema } from '@shared/api/external-resources'
export {
  createManagementConnectorRequestSchema,
  createManagementFederatedCredentialRequestSchema,
  createManagementFederatedCredentialResponseSchema,
  developerConsoleAccessPolicyResponseSchema,
  emailDeliveryConfigurationResponseSchema,
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
  managementRealmResponseSchema,
  managementSignInSettingsResponseSchema,
  managementUpdateUserRequestSchema,
  managementUserDetailResponseSchema,
  managementUserSecurityResponseSchema,
  organizationCreationPolicyResponseSchema,
  paginationQuerySchema,
  replaceDeveloperConsoleAccessPolicyRequestSchema,
  replaceEmailDeliveryConfigurationRequestSchema,
  replaceOrganizationCreationPolicyRequestSchema,
  updateManagementAccountCenterSettingsRequestSchema,
  updateManagementBrandingSettingsRequestSchema,
  updateManagementConnectorRequestSchema,
  updateManagementFederatedCredentialRequestSchema,
  updateManagementRealmRequestSchema,
  updateManagementSignInSettingsRequestSchema,
} from '@shared/api/management'
export { securityPolicyResponseSchema, updateSecurityPolicySchema } from '@shared/api/security'
export {
  createWebhookEndpointRequestSchema,
  idempotencyKeySchema,
  listWebhookDeliveryAttemptsResponseSchema,
  listWebhookEndpointsQuerySchema,
  listWebhookEndpointsResponseSchema,
  listWebhookRequestsQuerySchema,
  listWebhookRequestsResponseSchema,
  updateWebhookEndpointRequestSchema,
  webhookDeliveryAttemptSchema,
  webhookEndpointSchema,
  webhookEndpointSecretResponseSchema,
  webhookRequestSchema,
} from '@shared/api/webhooks'
export type { ZodType } from 'zod'

import { managementErrorResponseSchema } from '@shared/api/management'

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'
export interface ManagementRouteConfig {
  method: HttpMethod
  path: string
  operationId: string
  summary: string
  cli?: {
    group: 'access-request' | 'auth' | 'capability' | 'connection-request' | 'resource' | 'resource-server'
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
  responseHeaders?: Record<string, { description: string; schema: Record<string, unknown> }>
  errors?: Partial<Record<400 | 404 | 409 | 412 | 422 | 428 | 429 | 502, string>>
  security?: Array<Record<string, string[]>>
}
export const jsonContentType = 'application/json'
export const multipartContentType = 'multipart/form-data'
export const managementSecurity: Array<Record<string, string[]>> = [{ agentAuth: [] }, { browserSession: [] }]
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
export const applicationAuthorizationParam = params('applicationId', 'authorizationId')
export const authorizationIdParam = params('authorizationId')
export const federatedCredentialParam = params('applicationId', 'credentialId')
export const organizationIdParam = params('organizationId')
export const userIdParam = params('id')
export const userSessionParam = params('id', 'sessionId')
export const userPasskeyParam = params('id', 'passkeyId')
export const memberParam = params('id', 'memberId')
export const invitationParam = params('id', 'invitationId')
export const agentIdentityParam = params('identityId')
export const ifMatchHeader = z.object({
  'If-Match': z.string().openapi({ param: { name: 'If-Match', in: 'header' }, example: '"resource-version"' }),
})
export const idempotencyKeyHeader = z.object({
  'Idempotency-Key': idempotencyKeySchema.openapi({
    param: { name: 'Idempotency-Key', in: 'header' },
    example: '018f4f92-f32d-7af5-8ed0-83fe6c24d404',
  }),
})
export const locationResponseHeader = {
  Location: { description: 'Canonical URI of the created resource.', schema: { type: 'string' } },
}
export const interactiveResourceResponseHeaders = {
  Link: {
    description: 'Profile link identifying the generic interactive-resource representation.',
    schema: { type: 'string' },
  },
  'Retry-After': {
    description: 'Suggested polling interval in seconds while controller interaction is pending.',
    schema: { type: 'string' },
  },
}
export const credentialOfferResponseHeader = {
  Link: {
    description: 'Profile link identifying the generic Resource credential representation.',
    schema: { type: 'string' },
  },
}
export const etagResponseHeader = {
  ETag: { description: 'Current strong entity tag for the representation.', schema: { type: 'string' } },
}
export const idempotencyReplayResponseHeader = {
  'Idempotency-Replayed': {
    description: 'True when this response replays the resource reserved by the same idempotency key.',
    schema: { type: 'string', enum: ['true'] },
  },
}
