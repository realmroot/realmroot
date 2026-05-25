import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { ZodType } from 'zod'
import { agentProtocolInventoryResponseSchema } from '../../shared/api/agents'
import {
  applicationResponseSchema,
  createApplicationRequestSchema,
  createApplicationResponseSchema,
  listApplicationsResponseSchema,
  listClientSecretsResponseSchema,
  listRedirectUrisResponseSchema,
  replaceRedirectUrisRequestSchema,
  rotateClientSecretResponseSchema,
  systemCliClientId,
  updateApplicationRequestSchema,
} from '../../shared/api/applications'
import { uploadedAssetResponseSchema } from '../../shared/api/assets'
import {
  addMemberRequestSchema,
  apiPermissionResponseSchema,
  apiResourceResponseSchema,
  apiScopeResponseSchema,
  assignRoleRequestSchema,
  createApiPermissionRequestSchema,
  createApiResourceRequestSchema,
  createApiScopeRequestSchema,
  createInvitationRequestSchema,
  createOrganizationRequestSchema,
  createRoleRequestSchema,
  listApiPermissionsResponseSchema,
  listApiResourcesResponseSchema,
  listApiScopesResponseSchema,
  listInvitationsResponseSchema,
  listMembersResponseSchema,
  listOrganizationsResponseSchema,
  listRolesResponseSchema,
  organizationResponseSchema,
  replaceRolePermissionsRequestSchema,
  rolePermissionsResponseSchema,
  roleResponseSchema,
  updateApiPermissionRequestSchema,
  updateApiResourceRequestSchema,
  updateApiScopeRequestSchema,
  updateMemberRequestSchema,
  updateOrganizationRequestSchema,
  updateRoleRequestSchema,
} from '../../shared/api/authorization'
import { connectorReadinessResponseSchema, listConnectorTemplatesResponseSchema } from '../../shared/api/connectors'
import {
  createManagementConnectorRequestSchema,
  listManagementConnectorsResponseSchema,
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
  updateManagementSignInSettingsRequestSchema,
} from '../../shared/api/management'
import { securityPolicySchema, updateSecurityPolicySchema } from '../../shared/api/security'
import {
  createWebhookEndpointRequestSchema,
  listWebhookEndpointsQuerySchema,
  listWebhookEndpointsResponseSchema,
  listWebhookRequestsQuerySchema,
  listWebhookRequestsResponseSchema,
  updateWebhookEndpointRequestSchema,
  webhookEndpointSchema,
  webhookEndpointSecretResponseSchema,
  webhookRequestSchema,
} from '../../shared/api/webhooks'

interface ManagementOpenApiDocument {
  openapi: string
  info: unknown
  paths: Record<string, unknown>
  components: {
    securitySchemes: Record<string, unknown>
    parameters?: Record<string, unknown>
    pathItems?: Record<string, unknown>
    responses?: Record<string, unknown>
    schemas?: Record<string, unknown>
  }
  security?: unknown
  'x-cli-config': {
    security: string
    params: RestishCliConfigParams
  }
  [key: string]: unknown
}
type RestishCliConfigParams = Record<string, string>
type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

interface ManagementRouteConfig {
  method: HttpMethod
  path: string
  operationId: string
  summary: string
  request?: {
    params?: ZodType
    query?: ZodType
    body?: {
      content: Record<string, { schema: ZodType }>
      required?: boolean
    }
  }
  status?: number
  response?: ZodType
  noBody?: boolean
  security?: Array<Record<string, string[]>>
}

export const managementOpenApiPath = '/api/management/openapi.json'
export const managementOpenApiLinkHeader = [
  `<${managementOpenApiPath}>; rel="service-desc"; type="application/openapi+json"`,
  `<${managementOpenApiPath}>; rel="describedby"; type="application/openapi+json"`,
].join(', ')

const jsonContentType = 'application/json'
const multipartContentType = 'multipart/form-data'
const managementSecurity: Array<Record<string, string[]>> = [{ adminSession: [] }, { managementOAuth2: [] }]
const managementScopes = 'openid,profile,email,offline_access,management:read,management:write'

export function managementOpenApiForRequest(requestUrl: string): ManagementOpenApiDocument {
  const contract = structuredClone(managementOpenApi)
  const origin = new URL(requestUrl).origin
  const securitySchemes = contract.components?.securitySchemes as Record<string, unknown>
  const oauth = securitySchemes.managementOAuth2 as {
    flows: { authorizationCode: { authorizationUrl: string; tokenUrl: string } }
  }
  const flow = oauth.flows.authorizationCode

  flow.authorizationUrl = new URL(flow.authorizationUrl, origin).toString()
  flow.tokenUrl = new URL(flow.tokenUrl, origin).toString()

  const restishParams = contract['x-cli-config'].params as RestishCliConfigParams
  restishParams.authorize_url = flow.authorizationUrl
  restishParams.token_url = flow.tokenUrl

  return contract
}

function createManagementOpenApiApp() {
  const app = new OpenAPIHono()

  app.openAPIRegistry.registerComponent('securitySchemes', 'adminSession', {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
    description: 'Authenticated administrator session.',
  })
  app.openAPIRegistry.registerComponent('securitySchemes', 'managementOAuth2', {
    type: 'oauth2',
    description:
      'Management API OAuth 2.0 authorization code flow with PKCE for the built-in public native FlareAuth CLI client.',
    flows: {
      authorizationCode: {
        authorizationUrl: '/api/auth/oauth2/authorize',
        tokenUrl: '/api/auth/oauth2/token',
        scopes: {
          'management:read': 'Read Management API resources.',
          'management:write': 'Create, update, and delete Management API resources.',
        },
      },
    },
  })

  for (const routeConfig of managementRoutes) {
    app.openAPIRegistry.registerPath(createManagementRoute(routeConfig))
  }

  return app
}

function buildManagementOpenApi(): ManagementOpenApiDocument {
  const document = openApiApp.getOpenAPI31Document(
    {
      openapi: '3.1.0',
      info: {
        title: 'FlareAuth Management API',
        version: '2026-05-24',
        description: 'Administrative API for FlareAuth applications, users, connectors, security, and settings.',
      },
      servers: [{ url: '/api/management' }],
      security: managementSecurity,
    },
    { unionPreferredType: 'oneOf' },
  )

  return {
    ...document,
    'x-cli-config': {
      security: 'managementOAuth2',
      params: {
        client_id: systemCliClientId,
        scopes: managementScopes,
        redirect_url: 'http://localhost:8484/callback',
      },
    },
  } as ManagementOpenApiDocument
}

function createManagementRoute(routeConfig: ManagementRouteConfig) {
  return createRoute({
    method: routeConfig.method,
    path: routeConfig.path,
    operationId: routeConfig.operationId,
    summary: routeConfig.summary,
    security: routeConfig.security ?? managementSecurity,
    request: routeConfig.request as never,
    responses: routeResponses(routeConfig) as never,
  })
}

function routeResponses(routeConfig: ManagementRouteConfig) {
  const responses: Record<string, unknown> = {}

  if (routeConfig.noBody) {
    responses[routeConfig.status ?? 204] = { description: routeConfig.summary }
  } else {
    responses[routeConfig.status ?? 200] = {
      description: routeConfig.summary,
      content: {
        [jsonContentType]: {
          schema: routeConfig.response ?? z.object({ ok: z.boolean() }),
        },
      },
    }
  }

  if (routeConfig.security !== undefined && routeConfig.security.length === 0) {
    return responses
  }

  return {
    ...responses,
    401: errorResponse('Authentication is required.'),
    403: errorResponse('Administrator access is required.'),
  }
}

function errorResponse(description: string) {
  return {
    description,
    content: {
      [jsonContentType]: {
        schema: managementErrorResponseSchema,
      },
    },
  }
}

function jsonBody(schema: ZodType) {
  return {
    content: {
      [jsonContentType]: { schema },
    },
    required: true,
  }
}

function multipartBody() {
  return {
    content: {
      [multipartContentType]: {
        schema: z.object({
          file: z.string().openapi({ type: 'string', format: 'binary' }),
        }),
      },
    },
    required: true,
  }
}

function params(...names: string[]) {
  return z.object(
    Object.fromEntries(
      names.map((name) => [
        name,
        z.string().openapi({
          param: { name, in: 'path' },
          example: `${name}-1`,
        }),
      ]),
    ),
  )
}

const idParam = params('id')
const applicationIdParam = params('applicationId')
const organizationIdParam = params('organizationId')
const userIdParam = params('id')
const userSessionParam = params('id', 'sessionId')
const userPasskeyParam = params('id', 'passkeyId')
const apiPermissionParam = params('id', 'permissionId')
const apiScopeParam = params('id', 'scopeId')
const memberParam = params('id', 'memberId')
const invitationParam = params('id', 'invitationId')

const managementRoutes: ManagementRouteConfig[] = [
  {
    method: 'get',
    path: '/openapi.json',
    operationId: 'getManagementOpenApi',
    summary: 'Get Management OpenAPI document',
    response: z.record(z.string(), z.unknown()),
    security: [],
  },

  {
    method: 'get',
    path: '/applications',
    operationId: 'listApplications',
    summary: 'List applications',
    request: { query: paginationQuerySchema },
    response: listApplicationsResponseSchema,
  },
  {
    method: 'post',
    path: '/applications',
    operationId: 'createApplication',
    summary: 'Create application',
    request: { body: jsonBody(createApplicationRequestSchema) },
    response: createApplicationResponseSchema,
    status: 201,
  },
  {
    method: 'get',
    path: '/applications/{id}',
    operationId: 'getApplication',
    summary: 'Get application',
    request: { params: idParam },
    response: applicationResponseSchema,
  },
  {
    method: 'patch',
    path: '/applications/{id}',
    operationId: 'updateApplication',
    summary: 'Update application',
    request: { params: idParam, body: jsonBody(updateApplicationRequestSchema) },
    response: applicationResponseSchema,
  },
  {
    method: 'delete',
    path: '/applications/{id}',
    operationId: 'deleteApplication',
    summary: 'Delete application',
    request: { params: idParam },
    noBody: true,
  },
  {
    method: 'post',
    path: '/applications/{applicationId}/logo',
    operationId: 'uploadApplicationLogo',
    summary: 'Upload application logo',
    request: { params: applicationIdParam, body: multipartBody() },
    response: uploadedAssetResponseSchema,
    status: 201,
  },
  {
    method: 'get',
    path: '/applications/{id}/redirect-uris',
    operationId: 'listRedirectUris',
    summary: 'List application redirect URIs',
    request: { params: idParam, query: paginationQuerySchema },
    response: listRedirectUrisResponseSchema,
  },
  {
    method: 'put',
    path: '/applications/{id}/redirect-uris',
    operationId: 'replaceRedirectUris',
    summary: 'Replace application redirect URIs',
    request: { params: idParam, body: jsonBody(replaceRedirectUrisRequestSchema) },
    response: listRedirectUrisResponseSchema,
  },
  {
    method: 'get',
    path: '/applications/{id}/client-secrets',
    operationId: 'listClientSecrets',
    summary: 'List application client secrets',
    request: { params: idParam, query: paginationQuerySchema },
    response: listClientSecretsResponseSchema,
  },
  {
    method: 'post',
    path: '/applications/{id}/client-secrets',
    operationId: 'rotateClientSecret',
    summary: 'Rotate application client secret',
    request: { params: idParam },
    response: rotateClientSecretResponseSchema,
    status: 201,
  },

  {
    method: 'get',
    path: '/api-resources',
    operationId: 'listApiResources',
    summary: 'List API resources',
    request: { query: paginationQuerySchema },
    response: listApiResourcesResponseSchema,
  },
  {
    method: 'post',
    path: '/api-resources',
    operationId: 'createApiResource',
    summary: 'Create API resource',
    request: { body: jsonBody(createApiResourceRequestSchema) },
    response: apiResourceResponseSchema,
    status: 201,
  },
  {
    method: 'get',
    path: '/api-resources/{id}',
    operationId: 'getApiResource',
    summary: 'Get API resource',
    request: { params: idParam },
    response: apiResourceResponseSchema,
  },
  {
    method: 'patch',
    path: '/api-resources/{id}',
    operationId: 'updateApiResource',
    summary: 'Update API resource',
    request: { params: idParam, body: jsonBody(updateApiResourceRequestSchema) },
    response: apiResourceResponseSchema,
  },
  {
    method: 'delete',
    path: '/api-resources/{id}',
    operationId: 'deleteApiResource',
    summary: 'Delete API resource',
    request: { params: idParam },
    noBody: true,
  },
  {
    method: 'get',
    path: '/api-resources/{id}/scopes',
    operationId: 'listApiResourceScopes',
    summary: 'List API resource scopes',
    request: { params: idParam, query: paginationQuerySchema },
    response: listApiScopesResponseSchema,
  },
  {
    method: 'post',
    path: '/api-resources/{id}/scopes',
    operationId: 'createApiResourceScope',
    summary: 'Create API resource scope',
    request: { params: idParam, body: jsonBody(createApiScopeRequestSchema) },
    response: apiScopeResponseSchema,
    status: 201,
  },
  {
    method: 'patch',
    path: '/api-resources/{id}/scopes/{scopeId}',
    operationId: 'updateApiResourceScope',
    summary: 'Update API resource scope',
    request: { params: apiScopeParam, body: jsonBody(updateApiScopeRequestSchema) },
    response: apiScopeResponseSchema,
  },
  {
    method: 'delete',
    path: '/api-resources/{id}/scopes/{scopeId}',
    operationId: 'deleteApiResourceScope',
    summary: 'Delete API resource scope',
    request: { params: apiScopeParam },
    noBody: true,
  },
  {
    method: 'get',
    path: '/api-resources/{id}/permissions',
    operationId: 'listApiResourcePermissions',
    summary: 'List API resource permissions',
    request: { params: idParam, query: paginationQuerySchema },
    response: listApiPermissionsResponseSchema,
  },
  {
    method: 'post',
    path: '/api-resources/{id}/permissions',
    operationId: 'createApiResourcePermission',
    summary: 'Create API resource permission',
    request: { params: idParam, body: jsonBody(createApiPermissionRequestSchema) },
    response: apiPermissionResponseSchema,
    status: 201,
  },
  {
    method: 'patch',
    path: '/api-resources/{id}/permissions/{permissionId}',
    operationId: 'updateApiResourcePermission',
    summary: 'Update API resource permission',
    request: { params: apiPermissionParam, body: jsonBody(updateApiPermissionRequestSchema) },
    response: apiPermissionResponseSchema,
  },
  {
    method: 'delete',
    path: '/api-resources/{id}/permissions/{permissionId}',
    operationId: 'deleteApiResourcePermission',
    summary: 'Delete API resource permission',
    request: { params: apiPermissionParam },
    noBody: true,
  },

  {
    method: 'get',
    path: '/organizations',
    operationId: 'listOrganizations',
    summary: 'List organizations',
    request: { query: paginationQuerySchema },
    response: listOrganizationsResponseSchema,
  },
  {
    method: 'post',
    path: '/organizations',
    operationId: 'createOrganization',
    summary: 'Create organization',
    request: { body: jsonBody(createOrganizationRequestSchema) },
    response: organizationResponseSchema,
    status: 201,
  },
  {
    method: 'get',
    path: '/organizations/{id}',
    operationId: 'getOrganization',
    summary: 'Get organization',
    request: { params: idParam },
    response: organizationResponseSchema,
  },
  {
    method: 'patch',
    path: '/organizations/{id}',
    operationId: 'updateOrganization',
    summary: 'Update organization',
    request: { params: idParam, body: jsonBody(updateOrganizationRequestSchema) },
    response: organizationResponseSchema,
  },
  {
    method: 'delete',
    path: '/organizations/{id}',
    operationId: 'deleteOrganization',
    summary: 'Delete organization',
    request: { params: idParam },
    noBody: true,
  },
  {
    method: 'post',
    path: '/organizations/{organizationId}/logo',
    operationId: 'uploadOrganizationLogo',
    summary: 'Upload organization logo',
    request: { params: organizationIdParam, body: multipartBody() },
    response: uploadedAssetResponseSchema,
    status: 201,
  },
  {
    method: 'get',
    path: '/organizations/{id}/members',
    operationId: 'listOrganizationMembers',
    summary: 'List organization members',
    request: { params: idParam, query: paginationQuerySchema },
    response: listMembersResponseSchema,
  },
  {
    method: 'post',
    path: '/organizations/{id}/members',
    operationId: 'createOrganizationMember',
    summary: 'Create organization member',
    request: { params: idParam, body: jsonBody(addMemberRequestSchema) },
    response: z.object({ member: z.unknown() }),
    status: 201,
  },
  {
    method: 'patch',
    path: '/organizations/{id}/members/{memberId}',
    operationId: 'updateOrganizationMember',
    summary: 'Update organization member',
    request: { params: memberParam, body: jsonBody(updateMemberRequestSchema) },
    response: z.object({ member: z.unknown() }),
  },
  {
    method: 'delete',
    path: '/organizations/{id}/members/{memberId}',
    operationId: 'deleteOrganizationMember',
    summary: 'Delete organization member',
    request: { params: memberParam },
    noBody: true,
  },
  {
    method: 'get',
    path: '/organizations/{id}/invitations',
    operationId: 'listOrganizationInvitations',
    summary: 'List organization invitations',
    request: { params: idParam, query: paginationQuerySchema },
    response: listInvitationsResponseSchema,
  },
  {
    method: 'post',
    path: '/organizations/{id}/invitations',
    operationId: 'createOrganizationInvitation',
    summary: 'Create organization invitation',
    request: { params: idParam, body: jsonBody(createInvitationRequestSchema) },
    response: z.object({ invitation: z.unknown() }),
    status: 201,
  },
  {
    method: 'delete',
    path: '/organizations/{id}/invitations/{invitationId}',
    operationId: 'deleteOrganizationInvitation',
    summary: 'Delete organization invitation',
    request: { params: invitationParam },
    noBody: true,
  },

  {
    method: 'get',
    path: '/roles',
    operationId: 'listRoles',
    summary: 'List roles',
    request: { query: paginationQuerySchema },
    response: listRolesResponseSchema,
  },
  {
    method: 'post',
    path: '/roles',
    operationId: 'createRole',
    summary: 'Create role',
    request: { body: jsonBody(createRoleRequestSchema) },
    response: roleResponseSchema,
    status: 201,
  },
  {
    method: 'get',
    path: '/roles/{id}',
    operationId: 'getRole',
    summary: 'Get role',
    request: { params: idParam },
    response: roleResponseSchema,
  },
  {
    method: 'patch',
    path: '/roles/{id}',
    operationId: 'updateRole',
    summary: 'Update role',
    request: { params: idParam, body: jsonBody(updateRoleRequestSchema) },
    response: roleResponseSchema,
  },
  {
    method: 'delete',
    path: '/roles/{id}',
    operationId: 'deleteRole',
    summary: 'Delete role',
    request: { params: idParam },
    noBody: true,
  },
  {
    method: 'get',
    path: '/roles/{id}/permissions',
    operationId: 'listRolePermissions',
    summary: 'List role permissions',
    request: { params: idParam },
    response: rolePermissionsResponseSchema,
  },
  {
    method: 'put',
    path: '/roles/{id}/permissions',
    operationId: 'replaceRolePermissions',
    summary: 'Replace role permissions',
    request: { params: idParam, body: jsonBody(replaceRolePermissionsRequestSchema) },
    noBody: true,
  },
  ...assignmentRoutes(),

  {
    method: 'get',
    path: '/users',
    operationId: 'listUsers',
    summary: 'List users',
    response: listManagementUsersResponseSchema,
  },
  {
    method: 'post',
    path: '/users',
    operationId: 'createUser',
    summary: 'Create user',
    request: { body: jsonBody(managementCreateUserRequestSchema) },
    response: managementUserDetailResponseSchema,
    status: 201,
  },
  {
    method: 'get',
    path: '/users/{id}',
    operationId: 'getUser',
    summary: 'Get user',
    request: { params: userIdParam },
    response: managementUserDetailResponseSchema,
  },
  {
    method: 'patch',
    path: '/users/{id}',
    operationId: 'updateUser',
    summary: 'Update user',
    request: { params: userIdParam, body: jsonBody(managementUpdateUserRequestSchema) },
    response: managementUserDetailResponseSchema,
  },
  {
    method: 'delete',
    path: '/users/{id}',
    operationId: 'deleteUser',
    summary: 'Delete user',
    request: { params: userIdParam },
    noBody: true,
  },
  {
    method: 'put',
    path: '/users/{id}/ban',
    operationId: 'banUser',
    summary: 'Ban user',
    request: { params: userIdParam, body: jsonBody(managementBanUserRequestSchema) },
    response: managementUserDetailResponseSchema,
  },
  {
    method: 'post',
    path: '/users/{id}/ban',
    operationId: 'banUserCompatibility',
    summary: 'Ban user',
    request: { params: userIdParam, body: jsonBody(managementBanUserRequestSchema) },
    response: managementUserDetailResponseSchema,
  },
  {
    method: 'delete',
    path: '/users/{id}/ban',
    operationId: 'unbanUser',
    summary: 'Unban user',
    request: { params: userIdParam },
    response: managementUserDetailResponseSchema,
  },
  {
    method: 'post',
    path: '/users/{id}/unban',
    operationId: 'unbanUserCompatibility',
    summary: 'Unban user',
    request: { params: userIdParam },
    response: managementUserDetailResponseSchema,
  },
  {
    method: 'post',
    path: '/users/password-reset',
    operationId: 'requestUserPasswordResetCompatibility',
    summary: 'Create user password reset request',
    request: { body: jsonBody(managementPasswordResetRequestSchema) },
    response: z.object({ ok: z.boolean() }),
  },
  {
    method: 'post',
    path: '/users/password-reset-requests',
    operationId: 'createUserPasswordResetRequest',
    summary: 'Create user password reset request',
    request: { body: jsonBody(managementPasswordResetRequestSchema) },
    response: z.object({ ok: z.boolean() }),
  },
  {
    method: 'post',
    path: '/users/{id}/password-reset-requests',
    operationId: 'createUserPasswordResetRequestById',
    summary: 'Create user password reset request',
    request: { params: userIdParam },
    response: z.object({ ok: z.boolean() }),
  },
  {
    method: 'get',
    path: '/users/{id}/sessions',
    operationId: 'listUserSessions',
    summary: 'List user sessions',
    request: { params: userIdParam, query: paginationQuerySchema },
    response: listManagementUserSessionsResponseSchema,
  },
  {
    method: 'delete',
    path: '/users/{id}/sessions',
    operationId: 'deleteUserSessions',
    summary: 'Delete user sessions',
    request: { params: userIdParam },
    noBody: true,
  },
  {
    method: 'delete',
    path: '/users/{id}/sessions/{sessionId}',
    operationId: 'deleteUserSession',
    summary: 'Delete user session',
    request: { params: userSessionParam },
    noBody: true,
  },
  {
    method: 'get',
    path: '/users/{id}/linked-accounts',
    operationId: 'listUserLinkedAccounts',
    summary: 'List user linked accounts',
    request: { params: userIdParam, query: paginationQuerySchema },
    response: listManagementUserLinkedAccountsResponseSchema,
  },
  {
    method: 'get',
    path: '/users/{id}/applications',
    operationId: 'listUserApplications',
    summary: 'List user applications',
    request: { params: userIdParam, query: paginationQuerySchema },
    response: listManagementUserApplicationsResponseSchema,
  },
  {
    method: 'get',
    path: '/users/{id}/security',
    operationId: 'getUserSecurity',
    summary: 'Get user security',
    request: { params: userIdParam },
    response: managementUserSecurityResponseSchema,
  },
  {
    method: 'get',
    path: '/users/{id}/passkeys',
    operationId: 'listUserPasskeys',
    summary: 'List user passkeys',
    request: { params: userIdParam, query: paginationQuerySchema },
    response: listManagementUserPasskeysResponseSchema,
  },
  {
    method: 'delete',
    path: '/users/{id}/passkeys/{passkeyId}',
    operationId: 'deleteUserPasskey',
    summary: 'Delete user passkey',
    request: { params: userPasskeyParam },
    noBody: true,
  },

  {
    method: 'get',
    path: '/security/policy',
    operationId: 'getSecurityPolicy',
    summary: 'Get security policy',
    response: z.object({ policy: securityPolicySchema }),
  },
  {
    method: 'patch',
    path: '/security/policy',
    operationId: 'updateSecurityPolicy',
    summary: 'Update security policy',
    request: { body: jsonBody(updateSecurityPolicySchema) },
    response: z.object({ policy: securityPolicySchema }),
  },
  {
    method: 'get',
    path: '/security/users/{id}',
    operationId: 'getSecurityUser',
    summary: 'Get security user',
    request: { params: userIdParam },
    response: managementUserDetailResponseSchema,
  },
  {
    method: 'get',
    path: '/security/users/{id}/sessions',
    operationId: 'listSecurityUserSessions',
    summary: 'List security user sessions',
    request: { params: userIdParam, query: paginationQuerySchema },
    response: listManagementUserSessionsResponseSchema,
  },
  {
    method: 'delete',
    path: '/security/users/{id}/sessions',
    operationId: 'deleteSecurityUserSessions',
    summary: 'Delete security user sessions',
    request: { params: userIdParam },
    noBody: true,
  },
  {
    method: 'delete',
    path: '/security/users/{id}/sessions/{sessionId}',
    operationId: 'deleteSecurityUserSession',
    summary: 'Delete security user session',
    request: { params: userSessionParam },
    noBody: true,
  },
  {
    method: 'get',
    path: '/security/users/{id}/passkeys',
    operationId: 'listSecurityUserPasskeys',
    summary: 'List security user passkeys',
    request: { params: userIdParam, query: paginationQuerySchema },
    response: listManagementUserPasskeysResponseSchema,
  },
  {
    method: 'delete',
    path: '/security/users/{id}/passkeys/{passkeyId}',
    operationId: 'deleteSecurityUserPasskey',
    summary: 'Delete security user passkey',
    request: { params: userPasskeyParam },
    noBody: true,
  },

  {
    method: 'get',
    path: '/connectors',
    operationId: 'listConnectors',
    summary: 'List connectors',
    request: { query: paginationQuerySchema },
    response: listManagementConnectorsResponseSchema,
  },
  {
    method: 'post',
    path: '/connectors',
    operationId: 'createConnector',
    summary: 'Create connector',
    request: { body: jsonBody(createManagementConnectorRequestSchema) },
    response: managementConnectorResponseSchema,
    status: 201,
  },
  {
    method: 'get',
    path: '/connectors/{id}',
    operationId: 'getConnector',
    summary: 'Get connector',
    request: { params: idParam },
    response: managementConnectorResponseSchema,
  },
  {
    method: 'patch',
    path: '/connectors/{id}',
    operationId: 'updateConnector',
    summary: 'Update connector',
    request: { params: idParam, body: jsonBody(updateManagementConnectorRequestSchema) },
    response: managementConnectorResponseSchema,
  },
  {
    method: 'delete',
    path: '/connectors/{id}',
    operationId: 'deleteConnector',
    summary: 'Delete connector',
    request: { params: idParam },
    noBody: true,
  },
  {
    method: 'get',
    path: '/connectors/{id}/readiness',
    operationId: 'listConnectorReadiness',
    summary: 'Get connector readiness',
    request: { params: idParam },
    response: connectorReadinessResponseSchema,
  },
  {
    method: 'get',
    path: '/connectors/templates',
    operationId: 'listConnectorTemplates',
    summary: 'List connector templates',
    response: listConnectorTemplatesResponseSchema,
  },

  {
    method: 'get',
    path: '/sign-in-settings',
    operationId: 'getSignInSettings',
    summary: 'Get sign-in settings',
    response: managementSignInSettingsResponseSchema,
  },
  {
    method: 'patch',
    path: '/sign-in-settings',
    operationId: 'updateSignInSettings',
    summary: 'Update sign-in settings',
    request: { body: jsonBody(updateManagementSignInSettingsRequestSchema) },
    response: managementSignInSettingsResponseSchema,
  },
  {
    method: 'get',
    path: '/branding-settings',
    operationId: 'getBrandingSettings',
    summary: 'Get branding settings',
    response: managementBrandingSettingsResponseSchema,
  },
  {
    method: 'patch',
    path: '/branding-settings',
    operationId: 'updateBrandingSettings',
    summary: 'Update branding settings',
    request: { body: jsonBody(updateManagementBrandingSettingsRequestSchema) },
    response: managementBrandingSettingsResponseSchema,
  },
  {
    method: 'get',
    path: '/account-center-settings',
    operationId: 'getAccountCenterSettings',
    summary: 'Get account center settings',
    response: managementAccountCenterSettingsResponseSchema,
  },
  {
    method: 'patch',
    path: '/account-center-settings',
    operationId: 'updateAccountCenterSettings',
    summary: 'Update account center settings',
    request: { body: jsonBody(updateManagementAccountCenterSettingsRequestSchema) },
    response: managementAccountCenterSettingsResponseSchema,
  },
  {
    method: 'post',
    path: '/branding/logo',
    operationId: 'uploadBrandingLogo',
    summary: 'Upload branding logo',
    request: { body: multipartBody() },
    response: uploadedAssetResponseSchema,
    status: 201,
  },
  {
    method: 'post',
    path: '/branding/favicon',
    operationId: 'uploadBrandingFavicon',
    summary: 'Upload branding favicon',
    request: { body: multipartBody() },
    response: uploadedAssetResponseSchema,
    status: 201,
  },
  {
    method: 'get',
    path: '/readiness',
    operationId: 'getReadiness',
    summary: 'Get deployment readiness',
    response: managementReadinessResponseSchema,
  },
  {
    method: 'get',
    path: '/agents/protocol-inventory',
    operationId: 'getAgentProtocolInventory',
    summary: 'List delegated agent protocol inventory',
    request: { query: paginationQuerySchema },
    response: agentProtocolInventoryResponseSchema,
  },
  {
    method: 'delete',
    path: '/agents/{id}',
    operationId: 'revokeAgent',
    summary: 'Revoke delegated agent access',
    request: { params: idParam },
    noBody: true,
  },
  {
    method: 'delete',
    path: '/agent-hosts/{id}',
    operationId: 'revokeAgentHost',
    summary: 'Revoke delegated agent host access',
    request: { params: idParam },
    noBody: true,
  },
  {
    method: 'delete',
    path: '/agent-capability-grants/{id}',
    operationId: 'revokeAgentCapabilityGrant',
    summary: 'Revoke delegated agent capability grant',
    request: { params: idParam },
    noBody: true,
  },

  {
    method: 'get',
    path: '/webhooks/endpoints',
    operationId: 'listWebhookEndpoints',
    summary: 'List webhook endpoints',
    request: { query: listWebhookEndpointsQuerySchema },
    response: listWebhookEndpointsResponseSchema,
  },
  {
    method: 'post',
    path: '/webhooks/endpoints',
    operationId: 'createWebhookEndpoint',
    summary: 'Create webhook endpoint',
    request: { body: jsonBody(createWebhookEndpointRequestSchema) },
    response: webhookEndpointSecretResponseSchema,
    status: 201,
  },
  {
    method: 'get',
    path: '/webhooks/endpoints/{id}',
    operationId: 'getWebhookEndpoint',
    summary: 'Get webhook endpoint',
    request: { params: idParam },
    response: webhookEndpointSchema,
  },
  {
    method: 'patch',
    path: '/webhooks/endpoints/{id}',
    operationId: 'updateWebhookEndpoint',
    summary: 'Update webhook endpoint',
    request: { params: idParam, body: jsonBody(updateWebhookEndpointRequestSchema) },
    response: webhookEndpointSchema,
  },
  {
    method: 'delete',
    path: '/webhooks/endpoints/{id}',
    operationId: 'deleteWebhookEndpoint',
    summary: 'Delete webhook endpoint',
    request: { params: idParam },
    noBody: true,
  },
  {
    method: 'post',
    path: '/webhooks/endpoints/{id}/secrets',
    operationId: 'rotateWebhookEndpointSecret',
    summary: 'Rotate webhook endpoint secret',
    request: { params: idParam },
    response: webhookEndpointSecretResponseSchema,
    status: 201,
  },
  {
    method: 'get',
    path: '/webhooks/requests',
    operationId: 'listWebhookRequests',
    summary: 'List webhook requests',
    request: { query: listWebhookRequestsQuerySchema },
    response: listWebhookRequestsResponseSchema,
  },
  {
    method: 'get',
    path: '/webhooks/requests/{id}',
    operationId: 'getWebhookRequest',
    summary: 'Get webhook request',
    request: { params: idParam },
    response: webhookRequestSchema,
  },
  {
    method: 'post',
    path: '/webhooks/requests/{id}/retries',
    operationId: 'retryWebhookRequest',
    summary: 'Retry webhook request',
    request: { params: idParam },
    response: webhookRequestSchema,
    status: 202,
  },
]

const openApiApp = createManagementOpenApiApp()

export const managementOpenApi = buildManagementOpenApi()

function assignmentRoutes(): ManagementRouteConfig[] {
  const assignments = [
    ['user-role-assignments', 'assignUserRole'],
    ['member-role-assignments', 'assignMemberRole'],
    ['application-role-assignments', 'assignApplicationRole'],
    ['roles/assignments/users', 'assignUserRoleCompatibility'],
    ['roles/assignments/members', 'assignMemberRoleCompatibility'],
    ['roles/assignments/applications', 'assignApplicationRoleCompatibility'],
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
