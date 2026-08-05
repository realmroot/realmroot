import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import {
  accessGrantSchema,
  accessGrantsResponseSchema,
  accessRequestSchema,
  accessRequestsResponseSchema,
  agentStatusSchema,
  createAccessRequestSchema,
  createResourceConnectionRequestSchema,
  resourceConnectionRequestSchema,
  resourceServerResourceSchema,
  resourceServerResourcesResponseSchema,
  resourceServerSchema,
  resourceServersResponseSchema,
  targetCredentialProofSchema,
  targetTokenSchema,
} from '@shared/api/agent-api'
import { paginationQuerySchema } from '@shared/api/pagination'
import { realmrootOAuthScopes } from '@shared/authz'
import { managementOperationPolicy } from '@shared/management-authorization'
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
  profiles: Record<'default', RestishAgentProfile>
}
interface RestishAgentProfile {
  credentials: {
    dpop: {
      auth: {
        type: string
        params: Record<string, string>
      }
      satisfies: string[]
    }
  }
}

export const unifiedOpenApiPath = '/api/openapi.json'
export const unifiedOpenApiLinkHeader = [
  `<${unifiedOpenApiPath}>; rel="service-desc"; type="application/openapi+json"`,
  `<${unifiedOpenApiPath}>; rel="describedby"; type="application/openapi+json"`,
].join(', ')

const managementRoutes: ManagementRouteConfig[] = [
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
    path: '/agent/status',
    operationId: 'getAgentStatus',
    summary: 'Read the current Agent status',
    cli: { group: 'auth', name: 'whoami' },
    security: [{ dpop: ['agent:read'] }],
    response: agentStatusSchema,
  },
  {
    method: 'get',
    path: '/agent/resource-servers',
    operationId: 'listAgentResourceServers',
    summary: 'List Resource Servers visible to the current Agent',
    security: [{ dpop: ['resource-servers:read'] }],
    request: { query: paginationQuerySchema },
    response: resourceServersResponseSchema,
  },
  {
    method: 'get',
    path: '/agent/resource-servers/{resourceServerId}',
    operationId: 'getAgentResourceServer',
    summary: 'Read a Resource Server visible to the current Agent',
    security: [{ dpop: ['resource-servers:read'] }],
    request: { params: z.object({ resourceServerId: z.string() }) },
    response: resourceServerSchema,
    errors: { 404: 'The Resource Server was not found.' },
  },
  {
    method: 'get',
    path: '/agent/resource-servers/{resourceServerId}/resources',
    operationId: 'listResourceServerResources',
    summary: 'List provider-owned Resources available through a Resource Server',
    security: [{ dpop: ['resources:read'] }],
    request: {
      params: z.object({ resourceServerId: z.string() }),
      query: paginationQuerySchema,
    },
    response: resourceServerResourcesResponseSchema,
  },
  {
    method: 'get',
    path: '/agent/resource-servers/{resourceServerId}/resources/{resourceId}',
    operationId: 'getResourceServerResource',
    summary: 'Read a provider-owned Resource',
    security: [{ dpop: ['resources:read'] }],
    request: {
      params: z.object({ resourceServerId: z.string(), resourceId: z.string() }),
    },
    response: resourceServerResourceSchema,
    errors: { 404: 'The Resource was not found.' },
  },
  {
    method: 'post',
    path: '/agent/resource-servers/{resourceServerId}/connection-requests',
    operationId: 'createConnectionRequest',
    summary: 'Request a controller-managed Resource Server connection',
    cli: { name: 'connect' },
    security: [{ dpop: ['connection-requests:write'] }],
    request: {
      params: z.object({ resourceServerId: z.string() }),
      body: jsonBody(createResourceConnectionRequestSchema),
    },
    response: resourceConnectionRequestSchema,
    status: 201,
    responseHeaders: { ...locationResponseHeader, ...interactiveResourceResponseHeaders },
  },
  {
    method: 'get',
    path: '/agent/resource-servers/{resourceServerId}/connection-requests/{requestId}',
    operationId: 'getConnectionRequest',
    summary: 'Read a Resource Server connection request',
    security: [{ dpop: ['connection-requests:read'] }],
    request: { params: z.object({ resourceServerId: z.string(), requestId: z.string() }) },
    response: resourceConnectionRequestSchema,
    responseHeaders: interactiveResourceResponseHeaders,
  },
  {
    method: 'get',
    path: '/agent/access-requests',
    operationId: 'listCurrentAgentAuthorizationRequests',
    summary: 'List authorization requests created by the current Agent',
    security: [{ dpop: ['access-requests:read'] }],
    request: { query: paginationQuerySchema },
    response: accessRequestsResponseSchema,
  },
  {
    method: 'post',
    path: '/agent/access-requests',
    operationId: 'createAgentAuthorizationRequest',
    summary: 'Create an Agent authorization request',
    cli: { name: 'access' },
    security: [{ dpop: ['access-requests:write'] }],
    request: { body: jsonBody(createAccessRequestSchema) },
    response: accessRequestSchema,
    status: 201,
    responseHeaders: { ...locationResponseHeader, ...interactiveResourceResponseHeaders },
  },
  {
    method: 'get',
    path: '/agent/access-requests/{requestId}',
    operationId: 'getCurrentAgentAuthorizationRequest',
    summary: 'Read an authorization request created by the current Agent',
    security: [{ dpop: ['access-requests:read'] }],
    request: { params: z.object({ requestId: z.string() }) },
    response: accessRequestSchema,
    responseHeaders: interactiveResourceResponseHeaders,
    errors: { 404: 'The Agent authorization request was not found.' },
  },
  {
    method: 'get',
    path: '/agent/access-authorizations',
    operationId: 'listCurrentAgentAuthorizations',
    summary: 'List authorizations granted to the current Agent',
    security: [{ dpop: ['access-authorizations:read'] }],
    request: { query: paginationQuerySchema },
    response: accessGrantsResponseSchema,
  },
  {
    method: 'get',
    path: '/agent/access-authorizations/{authorizationId}',
    operationId: 'getCurrentAgentAuthorization',
    summary: 'Read an authorization granted to the current Agent',
    security: [{ dpop: ['access-authorizations:read'] }],
    request: { params: z.object({ authorizationId: z.string() }) },
    response: accessGrantSchema,
    errors: { 404: 'The Agent authorization was not found.' },
  },
  {
    method: 'post',
    path: '/agent/access-authorizations/{authorizationId}/credentials',
    operationId: 'createCurrentAgentAuthorizationCredential',
    summary: 'Create a temporary credential for an authorization granted to the current Agent',
    security: [{ dpop: ['access-authorizations:issue'] }],
    request: {
      params: z.object({ authorizationId: z.string() }),
      body: jsonBody(targetCredentialProofSchema),
    },
    response: targetTokenSchema,
  },
  ...agentGovernanceRoutes,
  ...applicationAuthorizationRoutes,
  ...userSecurityRoutes,
  ...platformWebhookRoutes,
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
  app.openAPIRegistry.registerComponent('securitySchemes', 'dpop', {
    type: 'http',
    scheme: 'DPoP',
    description:
      'RFC 9449 DPoP authentication with a short-lived, sender-constrained OAuth 2.0 access token. Discover token acquisition through the protected-resource and authorization-server metadata endpoints.',
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
        version: '2026-05-24',
        description:
          'Unified API for Agent identity, self-service resources, and permission-gated tenant administration.',
      },
      servers: [{ url: '/api' }],
    },
    { unionPreferredType: 'oneOf' },
  )
  return {
    ...document,
    'x-cli-config': {
      command_layout: 'tags',
      profiles: {
        default: restishAgentProfile(),
      },
    },
  } as UnifiedOpenApiDocument
}

function restishAgentProfile(): RestishAgentProfile {
  return {
    credentials: {
      dpop: {
        auth: {
          type: 'bearer',
          params: {
            token: 'realmroot-plugin-managed',
            provider: 'realmroot-agent',
          },
        },
        satisfies: realmrootOAuthScopes,
      },
    },
  }
}

function createManagementRoute(routeConfig: ManagementRouteConfig) {
  const managementPolicy =
    routeConfig.security === undefined
      ? managementOperationPolicy(routeConfig.method.toUpperCase(), routeConfig.path)
      : null
  if (routeConfig.security === undefined && !managementPolicy) {
    throw new Error(
      `OpenAPI management operation ${routeConfig.method.toUpperCase()} ${routeConfig.path} has no authorization policy.`,
    )
  }
  const requiredScope = managementPolicy?.scope ?? null
  return createRoute({
    method: routeConfig.method,
    path: routeConfig.path,
    operationId: routeConfig.operationId,
    summary: routeConfig.summary,
    ...(routeConfig.cli
      ? {
          ...(routeConfig.cli.group ? { tags: [routeConfig.cli.group] } : {}),
          'x-cli-name': routeConfig.cli.name,
        }
      : { 'x-cli-hidden': true }),
    ...(managementPolicy ? { 'x-realmroot-authorities': managementPolicy.authorities } : {}),
    security:
      routeConfig.security ??
      (requiredScope
        ? managementPolicy?.actor === 'human-controller'
          ? [{ sessionCookie: [] }]
          : [{ dpop: [requiredScope] }, { sessionCookie: [] }]
        : [{ sessionCookie: [] }]),
    request: routeConfig.request as never,
    responses: routeResponses(routeConfig) as never,
  })
}

function routeResponses(routeConfig: ManagementRouteConfig) {
  const responses: Record<string, unknown> = {}
  if (routeConfig.noBody) responses[routeConfig.status ?? 204] = { description: routeConfig.summary }
  else
    responses[routeConfig.status ?? 200] = {
      description: routeConfig.summary,
      ...(routeConfig.responseHeaders ? { headers: routeConfig.responseHeaders } : {}),
      content: { [jsonContentType]: { schema: routeConfig.response } },
    }
  if (routeConfig.security !== undefined && routeConfig.security.length === 0) return responses
  return {
    ...responses,
    ...Object.fromEntries(
      Object.entries(routeConfig.errors ?? {}).map(([status, description]) => [status, errorResponse(description)]),
    ),
    401: errorResponse('Authentication is required.'),
    403: errorResponse('The authenticated principal is not authorized for this resource boundary.'),
  }
}
