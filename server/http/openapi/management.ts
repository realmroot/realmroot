import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import {
  accessRequestSchema,
  agentStatusSchema,
  createAccessRequestSchema,
  createResourceConnectionRequestSchema,
  resourceConnectionRequestSchema,
  resourceServerResourceSchema,
  resourceServerResourcesResponseSchema,
} from '@shared/api/agent-api'
import { providerConnectionEventIdSchema, providerConnectionEventSchema } from '@shared/api/external-resources'
import { paginationQuerySchema } from '@shared/api/pagination'
import {
  publicAgentResponseSchema,
  publicProfileQuerySchema,
  publicUserResponseSchema,
} from '@shared/api/public-profiles'
import { usernameSchema } from '@shared/api/users'
import { requiredProtectedScope } from '@shared/authz'
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
}

export const unifiedOpenApiPath = '/api/openapi.json'
export const unifiedOpenApiLinkHeader = [
  `<${unifiedOpenApiPath}>; rel="service-desc"; type="application/openapi+json"`,
  `<${unifiedOpenApiPath}>; rel="describedby"; type="application/openapi+json"`,
].join(', ')

const managementOpenApiTags = [
  { name: 'Assets', description: 'Uploaded assets used by Realmroot resources.' },
  { name: 'Agents', description: 'Agent identities, installations, and lifecycle.' },
  { name: 'Agent Access', description: 'Agent access requests and approval decisions.' },
  { name: 'Applications', description: 'OIDC and machine-to-machine client applications.' },
  { name: 'Consents', description: 'User consent records for delegated Application access.' },
  { name: 'Resource Servers', description: 'Protected Resource Servers, contracts, and connections.' },
  { name: 'Organizations', description: 'Organizations, memberships, invitations, and roles.' },
  { name: 'Users', description: 'Realmroot users and account security resources.' },
  { name: 'Connectors', description: 'External identity and resource connectors.' },
  { name: 'Realm Configuration', description: 'Realm-wide hosted experience and platform configuration.' },
  { name: 'Security', description: 'Realm-wide authentication and security policy.' },
  { name: 'Webhooks', description: 'Webhook endpoints, deliveries, attempts, and secrets.' },
  { name: 'Audit Events', description: 'Immutable Realmroot governance audit events.' },
  { name: 'Public Profiles', description: 'Public representations of User and Agent identities.' },
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
      params: z.object({ subject: z.string().regex(/^agt_[a-zA-Z0-9_-]+$/) }),
      query: publicProfileQuerySchema,
      headers: publicProfileRequestHeaders,
    },
    response: publicAgentResponseSchema,
    responseHeaders: publicProfileResponseHeaders,
    additionalResponses: publicProfileAdditionalResponses,
    errors: { 400: 'The subject or view is invalid.', 404: 'The public Agent was not found.' },
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
    path: '/agent/status',
    operationId: 'getAgentStatus',
    summary: 'Read the current Agent status',
    cli: { group: 'Agents', name: 'whoami' },
    security: [{ dpop: ['agent:read'] }],
    response: agentStatusSchema,
  },
  {
    method: 'get',
    path: '/resource-servers/{resourceServerId}/resources',
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
    path: '/resource-servers/{resourceServerId}/resources/{resourceId}',
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
    path: '/resource-servers/{resourceServerId}/connection-requests',
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
    method: 'put',
    path: '/provider-connection-events/{eventId}',
    operationId: 'replaceProviderConnectionEvent',
    summary: 'Apply an idempotent provider Connection Event',
    security: [
      {
        providerConnectionEventSecret: [],
        providerConnectionEventTimestamp: [],
        providerConnectionEventSignature: [],
      },
    ],
    request: {
      params: z.object({
        eventId: providerConnectionEventIdSchema.meta({
          param: { name: 'eventId', in: 'path' },
          example: 'delivery-018f4f92',
        }),
      }),
      headers: z.object({
        'Realmroot-Timestamp': z
          .string()
          .regex(/^\d+$/)
          .meta({
            param: { name: 'Realmroot-Timestamp', in: 'header' },
            example: '1786233600',
          }),
        'Realmroot-Signature': z
          .string()
          .regex(/^sha256=[a-f0-9]{64}$/)
          .meta({
            param: { name: 'Realmroot-Signature', in: 'header' },
            example: `sha256=${'0'.repeat(64)}`,
          }),
      }),
      body: jsonBody(providerConnectionEventSchema),
    },
    status: 204,
    noBody: true,
    errors: {
      400: 'The event representation, resource, or timestamp is invalid.',
      404: 'The referenced Connection was not found.',
      409: 'The event identity was already used for a different representation.',
      413: 'The event representation exceeds 64 KiB.',
    },
    additionalResponses: {
      401: { description: 'The backchannel credential or body signature is missing, stale, or invalid.' },
    },
  },
  {
    method: 'get',
    path: '/resource-servers/{resourceServerId}/connection-requests/{requestId}',
    operationId: 'getConnectionRequest',
    summary: 'Read a Resource Server connection request',
    security: [{ dpop: ['connection-requests:read'] }],
    request: { params: z.object({ resourceServerId: z.string(), requestId: z.string() }) },
    response: resourceConnectionRequestSchema,
    responseHeaders: interactiveResourceResponseHeaders,
  },
  {
    method: 'post',
    path: '/access/requests',
    operationId: 'createAgentAuthorizationRequest',
    summary: 'Create an Agent authorization request',
    cli: { name: 'access' },
    security: [{ dpop: ['access-requests:write'] }],
    request: { body: jsonBody(createAccessRequestSchema) },
    response: accessRequestSchema,
    status: 201,
    responseHeaders: { ...locationResponseHeader, ...interactiveResourceResponseHeaders },
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
  app.openAPIRegistry.registerComponent('securitySchemes', 'providerConnectionEventSecret', {
    type: 'http',
    scheme: 'bearer',
    description: 'Resource-scoped provider Connection Event backchannel secret.',
  })
  app.openAPIRegistry.registerComponent('securitySchemes', 'providerConnectionEventTimestamp', {
    type: 'apiKey',
    in: 'header',
    name: 'Realmroot-Timestamp',
    description: 'Unix timestamp within five minutes of Realmroot time.',
  })
  app.openAPIRegistry.registerComponent('securitySchemes', 'providerConnectionEventSignature', {
    type: 'apiKey',
    in: 'header',
    name: 'Realmroot-Signature',
    description: 'HMAC-SHA256 signature over timestamp, method, request path, and exact request body.',
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
      (requiredScope ? [{ dpop: [requiredScope] }, { sessionCookie: [requiredScope] }] : [{ sessionCookie: [] }]),
    request: routeConfig.request as never,
    responses: routeResponses(routeConfig) as never,
  })
}

function managementTagForPath(path: string): (typeof managementOpenApiTags)[number]['name'] {
  if (path.startsWith('/public/')) return 'Public Profiles'
  if (path.startsWith('/assets')) return 'Assets'
  if (path === '/agent/status' || path.startsWith('/agents')) return 'Agents'
  if (path.startsWith('/access/requests')) return 'Agent Access'
  if (path.startsWith('/access/consents')) return 'Consents'
  if (path.startsWith('/applications')) return 'Applications'
  if (path.startsWith('/resource-servers')) return 'Resource Servers'
  if (path.startsWith('/provider-connection-events')) return 'Resource Servers'
  if (path.startsWith('/organizations')) return 'Organizations'
  if (path.startsWith('/users')) return 'Users'
  if (path.startsWith('/connectors')) return 'Connectors'
  if (path === '/realm/security-policy') return 'Security'
  if (path === '/realm/audit-events') return 'Audit Events'
  if (path.startsWith('/realm')) return 'Realm Configuration'
  if (path.startsWith('/webhooks')) return 'Webhooks'
  throw new Error(`Management OpenAPI route has no domain tag: ${path}`)
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
