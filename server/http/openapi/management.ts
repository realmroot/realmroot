import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import {
  accessRequestSchema,
  agentStatusSchema,
  createAccessRequestSchema,
  resourceServerAuthorizationDetailsResponseSchema,
} from '@shared/api/agent-api'
import { agentPublicIdentifierSchema } from '@shared/api/identifiers'
import { paginationQuerySchema } from '@shared/api/pagination'
import {
  publicAgentResponseSchema,
  publicProfileQuerySchema,
  publicUserResponseSchema,
} from '@shared/api/public-profiles'
import { usernameSchema } from '@shared/api/users'
import { agentBootstrapScopes, realmrootOAuthScopes, requiredProtectedScope } from '@shared/authz'
import { realmrootManagementScopes } from '@shared/scope-registry'
import { z } from 'zod'
import { agentGovernanceRoutes } from './management-routes/agent-governance'
import { applicationAuthorizationRoutes } from './management-routes/applications-authorization'
import {
  errorResponse,
  interactiveResourceResponseHeaders,
  jsonBody,
  jsonContentType,
  locationResponseHeader,
  type ManagementRouteConfig,
  uploadedAssetResponseSchema,
} from './management-routes/helpers'
import { platformRuntimeRoutes } from './management-routes/platform-runtime'
import { platformWebhookRoutes } from './management-routes/platform-webhooks'
import { userSecurityRoutes } from './management-routes/users-security'

interface UnifiedOpenApiDocument {
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
  'x-cli-config': RestishCliConfig
  [key: string]: unknown
}
interface RestishCliConfig {
  command_layout: 'tags'
}

export const unifiedOpenApiPath = '/api/openapi.json'
export const unifiedOpenApiLinkHeader = [
  `<${unifiedOpenApiPath}>; rel="service-desc"; type="application/openapi+json"`,
  `<${unifiedOpenApiPath}>; rel="describedby"; type="application/openapi+json"`,
].join(', ')

const managementOpenApiTags = [
  { name: 'Assets', description: 'Uploaded assets used by Realmroot resources.' },
  { name: 'Agent', description: 'Authenticated Agent bootstrap and access protocol resources.' },
  { name: 'Agents', description: 'Agent identities, installations, and lifecycle.' },
  { name: 'Applications', description: 'OIDC and machine-to-machine client applications.' },
  { name: 'Resource Servers', description: 'Protected Resource Servers, contracts, and connections.' },
  { name: 'Organizations', description: 'Organizations, memberships, invitations, and roles.' },
  { name: 'Users', description: 'Realmroot users and account security resources.' },
  { name: 'Connectors', description: 'External identity and resource connectors.' },
  { name: 'Webhooks', description: 'Webhook endpoints, deliveries, attempts, and secrets.' },
  { name: 'Public Profiles', description: 'Public representations of User and Agent identities.' },
  { name: 'Platform', description: 'Realm-wide resources, service health, and operational metadata.' },
] as const

const publicProfileResponseHeaders = {
  ETag: { description: 'Validator for the selected public representation.', schema: { type: 'string' } },
  'Cache-Control': {
    description: 'Shared-cache policy for the selected public representation.',
    schema: { type: 'string' },
  },
}

const publicProfileRequestHeaders = z.object({
  'If-None-Match': z
    .string()
    .optional()
    .openapi({
      param: { name: 'If-None-Match', in: 'header' },
      example: '"representation-version"',
    }),
})

const publicProfileAdditionalResponses = {
  304: {
    description: 'The selected public representation has not changed.',
    headers: publicProfileResponseHeaders,
  },
}

const managementRoutes: ManagementRouteConfig[] = [
  {
    method: 'get',
    path: '/public/users/{username}',
    operationId: 'getPublicUser',
    summary: 'Get a public User representation',
    security: [],
    request: {
      params: z.object({ username: usernameSchema }),
      query: publicProfileQuerySchema,
      headers: publicProfileRequestHeaders,
    },
    response: publicUserResponseSchema,
    responseHeaders: publicProfileResponseHeaders,
    additionalResponses: publicProfileAdditionalResponses,
    errors: { 400: 'The username or view is invalid.', 404: 'The public User was not found.' },
  },
  {
    method: 'get',
    path: '/public/agents/{subject}',
    operationId: 'getPublicAgent',
    summary: 'Get a public Agent representation',
    security: [],
    request: {
      params: z.object({ subject: agentPublicIdentifierSchema }),
      query: publicProfileQuerySchema,
      headers: publicProfileRequestHeaders,
    },
    response: publicAgentResponseSchema,
    responseHeaders: publicProfileResponseHeaders,
    additionalResponses: publicProfileAdditionalResponses,
    errors: { 400: 'The Agent identifier or view is invalid.', 404: 'The public Agent was not found.' },
  },
  {
    method: 'post',
    path: '/assets',
    operationId: 'createAsset',
    summary: 'Create an Asset',
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              purpose: z.enum(['avatar', 'application_logo', 'organization_logo', 'branding_logo', 'favicon']),
              file: z.string().openapi({ format: 'binary' }),
            }),
          },
        },
      },
    },
    response: uploadedAssetResponseSchema,
    status: 201,
    responseHeaders: locationResponseHeader,
  },
  {
    method: 'get',
    path: '/assets/{assetId}',
    operationId: 'getAsset',
    summary: 'Get an Asset',
    security: [],
    request: { params: z.object({ assetId: z.string() }) },
    response: z.unknown(),
  },
  {
    method: 'get',
    path: '/agent',
    operationId: 'getAgentStatus',
    summary: 'Read the current Agent status',
    cli: { group: 'Agent', name: 'whoami' },
    security: [{ oauth2: ['agent:read'] }],
    response: agentStatusSchema,
  },
  {
    method: 'get',
    path: '/resource-servers/{resourceServerId}/authorization-details',
    operationId: 'listResourceServerAuthorizationDetails',
    summary: 'List authorization details available through a Resource Server',
    security: [{ oauth2: ['authorization-details:read'] }],
    request: {
      params: z.object({ resourceServerId: z.string() }),
      query: paginationQuerySchema,
    },
    response: resourceServerAuthorizationDetailsResponseSchema,
  },
  {
    method: 'post',
    path: '/agent/access-requests',
    operationId: 'createAgentAuthorizationRequest',
    summary: 'Create an Agent authorization request',
    cli: { name: 'access' },
    security: [{ oauth2: ['access-requests:read', 'access-requests:write'] }],
    request: { body: jsonBody(createAccessRequestSchema) },
    response: accessRequestSchema,
    status: 201,
    responseHeaders: { ...locationResponseHeader, ...interactiveResourceResponseHeaders },
  },
  {
    method: 'get',
    path: '/agent/access-requests/{requestId}',
    operationId: 'getAgentAuthorizationRequest',
    summary: "Get the authenticated Agent's authorization request",
    security: [{ oauth2: ['access-requests:read'] }],
    request: { params: z.object({ requestId: z.string() }) },
    response: accessRequestSchema,
    responseHeaders: interactiveResourceResponseHeaders,
    errors: { 404: 'The Agent access request was not found.' },
  },
  ...agentGovernanceRoutes,
  ...applicationAuthorizationRoutes,
  ...userSecurityRoutes,
  ...platformWebhookRoutes,
  ...platformRuntimeRoutes,
]
const openApiApp = createManagementOpenApiApp()
export const unifiedOpenApi = buildUnifiedOpenApi()

function createManagementOpenApiApp() {
  const app = new OpenAPIHono()
  app.openAPIRegistry.registerComponent('securitySchemes', 'sessionCookie', {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
    description: 'Authenticated browser session; each operation applies Realm, Organization, or account visibility.',
  })
  app.openAPIRegistry.registerComponent('securitySchemes', 'agentAssertion', {
    type: 'http',
    scheme: 'bearer',
    description: 'Short-lived Agent protocol assertion used only to create and read Agent enrollments.',
  })
  app.openAPIRegistry.registerComponent('securitySchemes', 'oauth2', {
    type: 'oauth2',
    'x-dpop-required': true,
    flows: {
      authorizationCode: {
        authorizationUrl: '/api/auth/oauth2/authorize',
        tokenUrl: '/api/auth/oauth2/token',
        scopes: Object.fromEntries(realmrootOAuthScopes.map((scope) => [scope, oauthScopeDescription(scope)])),
      },
      clientCredentials: {
        tokenUrl: '/api/auth/oauth2/token',
        scopes: Object.fromEntries(realmrootManagementScopes.map((scope) => [scope, oauthScopeDescription(scope)])),
      },
    },
    description: 'Resource-bound Realmroot OAuth 2.0 management credential with an RFC 9449 DPoP proof.',
  })
  for (const routeConfig of managementRoutes) app.openAPIRegistry.registerPath(createManagementRoute(routeConfig))
  return app
}

function buildUnifiedOpenApi(): UnifiedOpenApiDocument {
  const document = openApiApp.getOpenAPI31Document(
    {
      openapi: '3.1.0',
      info: {
        title: 'Realmroot API',
        version: '2026-08-09',
        description:
          'Unified API for Agent identity, self-service resources, and permission-gated tenant administration.',
      },
      tags: [...managementOpenApiTags],
      servers: [{ url: '/api' }],
    },
    { unionPreferredType: 'oneOf' },
  )
  return {
    ...document,
    'x-cli-config': {
      command_layout: 'tags',
    },
  } as UnifiedOpenApiDocument
}

function createManagementRoute(routeConfig: ManagementRouteConfig) {
  const requiredScope =
    routeConfig.security === undefined
      ? requiredProtectedScope(routeConfig.method.toUpperCase(), routeConfig.path)
      : null
  return createRoute({
    method: routeConfig.method,
    path: routeConfig.path,
    operationId: routeConfig.operationId,
    summary: routeConfig.summary,
    tags: [routeConfig.cli?.group ?? managementTagForPath(routeConfig.path)],
    ...(routeConfig.cli
      ? {
          'x-cli-name': routeConfig.cli.name,
        }
      : { 'x-cli-hidden': true }),
    security:
      routeConfig.security ??
      (requiredScope ? [{ oauth2: [requiredScope] }, { sessionCookie: [requiredScope] }] : [{ sessionCookie: [] }]),
    request: routeConfig.request as never,
    responses: routeResponses(routeConfig) as never,
  })
}

function oauthScopeDescription(scope: string) {
  return agentBootstrapScopes.includes(scope as (typeof agentBootstrapScopes)[number])
    ? `Realmroot Agent protocol scope: ${scope}`
    : `Realmroot Resource management scope: ${scope}`
}

function managementTagForPath(path: string): (typeof managementOpenApiTags)[number]['name'] {
  if (path.startsWith('/public/')) return 'Public Profiles'
  if (path.startsWith('/assets')) return 'Assets'
  if (path === '/agent' || path.startsWith('/agent/')) return 'Agent'
  if (path.startsWith('/agents')) return 'Agents'
  if (path.startsWith('/applications')) return 'Applications'
  if (path.startsWith('/resource-servers')) return 'Resource Servers'
  if (path.startsWith('/organizations')) return 'Organizations'
  if (path.startsWith('/users')) return 'Users'
  if (path.startsWith('/connectors')) return 'Connectors'
  if (path === '/realm' || path.startsWith('/realm/')) return 'Platform'
  if (path.startsWith('/webhooks')) return 'Webhooks'
  throw new Error(`Management OpenAPI route has no domain tag: ${path}`)
}

function routeResponses(routeConfig: ManagementRouteConfig) {
  const responses: Record<string, unknown> = {}
  if (routeConfig.noBody)
    responses[routeConfig.status ?? 204] = {
      description: routeConfig.summary,
      ...(routeConfig.responseHeaders ? { headers: routeConfig.responseHeaders } : {}),
    }
  else
    responses[routeConfig.status ?? 200] = {
      description: routeConfig.summary,
      ...(routeConfig.responseHeaders ? { headers: routeConfig.responseHeaders } : {}),
      content: { [jsonContentType]: { schema: routeConfig.response } },
    }
  const expectedErrors = Object.fromEntries(
    Object.entries(routeConfig.errors ?? {}).map(([status, error]) => [
      status,
      typeof error === 'string' ? errorResponse(error) : errorResponse(error.description, error.schema, error.headers),
    ]),
  )
  const additionalResponses = routeConfig.additionalResponses ?? {}
  if (routeConfig.security !== undefined && routeConfig.security.length === 0) {
    return { ...responses, ...additionalResponses, ...expectedErrors }
  }
  return {
    ...responses,
    ...additionalResponses,
    ...expectedErrors,
    401: errorResponse('Authentication is required.'),
    403: errorResponse('Administrator access is required.'),
  }
}
