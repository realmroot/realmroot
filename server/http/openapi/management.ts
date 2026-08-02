import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import {
  accessGrantSchema,
  accessGrantsResponseSchema,
  accessRequestSchema,
  agentApiResourcesResponseSchema,
  agentInstallationEnrollmentResponseSchema,
  agentInstallationEnrollmentSchema,
  agentResponseSchema,
  authorizationDetailCatalogResponseSchema,
  createAccessRequestSchema,
  createAgentEnrollmentSchema,
  createAgentInstallationEnrollmentSchema,
  targetTokenSchema,
} from '@shared/api/agent-api'
import { paginationQuerySchema } from '@shared/api/pagination'
import { protectedResourceCapabilityNames, requiredProtectedCapability } from '@shared/authz'
import { z } from 'zod'
import { agentGovernanceRoutes } from './management-routes/agent-governance'
import { applicationAuthorizationRoutes } from './management-routes/applications-authorization'
import {
  errorResponse,
  idempotencyKeyHeader,
  idempotencyReplayResponseHeader,
  jsonBody,
  jsonContentType,
  locationResponseHeader,
  type ManagementRouteConfig,
  managementSecurity,
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
  profiles: {
    default: {
      credentials: {
        agentAuth: {
          auth: {
            type: string
            params: Record<string, string>
          }
          params: Record<string, string>
          satisfies: string[]
        }
      }
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
    method: 'get',
    path: '/agent',
    operationId: 'getCurrentAgent',
    summary: 'Read the current Agent',
    cli: { group: 'auth', name: 'whoami' },
    security: [{ agentAuth: [] }],
    response: agentResponseSchema,
  },
  {
    method: 'post',
    path: '/agent/enrollments',
    operationId: 'enrollAgent',
    summary: 'Create the current stable Agent',
    security: [{ agentAuth: [] }],
    request: { body: jsonBody(createAgentEnrollmentSchema) },
    response: agentResponseSchema,
    status: 201,
  },
  {
    method: 'post',
    path: '/agent/installation-enrollments',
    operationId: 'createAgentInstallationEnrollment',
    summary: 'Create an Agent installation enrollment',
    security: [{ agentAuth: [] }],
    request: { headers: idempotencyKeyHeader, body: jsonBody(createAgentInstallationEnrollmentSchema) },
    response: agentInstallationEnrollmentResponseSchema,
    status: 201,
    responseHeaders: { ...locationResponseHeader, ...idempotencyReplayResponseHeader },
    errors: {
      400: 'Idempotency-Key is missing or invalid.',
      409: 'Idempotency-Key was already used for a different Agent installation enrollment.',
    },
  },
  {
    method: 'get',
    path: '/agent/installation-enrollments/{enrollmentId}',
    operationId: 'getAgentInstallationEnrollment',
    summary: 'Read an Agent installation enrollment',
    security: [{ agentAuth: [] }],
    request: { params: z.object({ enrollmentId: z.string() }) },
    response: agentInstallationEnrollmentSchema,
  },
  {
    method: 'get',
    path: '/agent/api-resources',
    operationId: 'listAgentApiResources',
    summary: 'List API resources available to the Agent',
    security: [{ agentAuth: [] }],
    response: agentApiResourcesResponseSchema,
  },
  {
    method: 'get',
    path: '/agent/api-resources/{resourceId}/authorization-detail-catalog',
    operationId: 'listAgentAuthorizationDetailCatalog',
    summary: 'List available authorization contexts for an API resource',
    cli: { group: 'access', name: 'contexts' },
    security: [{ agentAuth: [] }],
    request: {
      params: z.object({ resourceId: z.string() }),
      query: paginationQuerySchema,
    },
    response: authorizationDetailCatalogResponseSchema,
  },
  {
    method: 'post',
    path: '/agent/access-requests',
    operationId: 'createAgentAccessRequest',
    summary: 'Request exact API resource access',
    cli: { group: 'access', name: 'request' },
    security: [{ agentAuth: [] }],
    request: { body: jsonBody(createAccessRequestSchema) },
    response: accessRequestSchema,
    status: 201,
  },
  {
    method: 'get',
    path: '/agent/access-requests/{requestId}',
    operationId: 'getAgentAccessRequest',
    summary: 'Get an Agent access request',
    security: [{ agentAuth: [] }],
    request: { params: z.object({ requestId: z.string() }) },
    response: accessRequestSchema,
  },
  {
    method: 'get',
    path: '/agent/access-grants',
    operationId: 'listAgentAccessGrants',
    summary: 'List active Agent access grants',
    security: [{ agentAuth: [] }],
    response: accessGrantsResponseSchema,
  },
  {
    method: 'get',
    path: '/agent/access-grants/{grantId}',
    operationId: 'getAgentAccessGrant',
    summary: 'Get an Agent access grant',
    security: [{ agentAuth: [] }],
    request: { params: z.object({ grantId: z.string() }) },
    response: accessGrantSchema,
  },
  {
    method: 'post',
    path: '/agent/access-grants/{grantId}/tokens',
    operationId: 'issueTargetAccessToken',
    summary: 'Issue an API resource DPoP token',
    cli: { group: 'access', name: 'token' },
    security: [{ agentAuth: [] }],
    request: { params: z.object({ grantId: z.string() }) },
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
  app.openAPIRegistry.registerComponent('securitySchemes', 'browserSession', {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
    description: 'Authenticated browser session; each operation applies Realm, Organization, or account visibility.',
  })
  app.openAPIRegistry.registerComponent('securitySchemes', 'agentAuth', {
    type: 'apiKey',
    in: 'header',
    name: 'Authorization',
    description:
      'AgentAuth possession proof supplied transparently by the Realmroot Restish authentication adapter. Required capabilities are declared per operation.',
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
      security: managementSecurity,
    },
    { unionPreferredType: 'oneOf' },
  )
  return {
    ...document,
    'x-cli-config': {
      profiles: {
        default: {
          credentials: {
            agentAuth: {
              auth: {
                type: 'api-key',
                params: {
                  in: 'header',
                  name: 'Authorization',
                  value: 'AgentAuth',
                  provider: 'realmroot-agent',
                },
              },
              params: {
                provider: 'realmroot-agent',
              },
              satisfies: protectedResourceCapabilityNames,
            },
          },
        },
      },
    },
  } as UnifiedOpenApiDocument
}

function createManagementRoute(routeConfig: ManagementRouteConfig) {
  const requiredAgentCapability = requiredProtectedCapability(routeConfig.method.toUpperCase(), routeConfig.path)
  return createRoute({
    method: routeConfig.method,
    path: routeConfig.path,
    operationId: routeConfig.operationId,
    summary: routeConfig.summary,
    ...(routeConfig.cli
      ? { tags: [routeConfig.cli.group], 'x-cli-name': routeConfig.cli.name }
      : { 'x-cli-hidden': true }),
    security: routeConfig.security ?? managementSecurity,
    ...(requiredAgentCapability ? { 'x-required-agent-capability': requiredAgentCapability } : {}),
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
    403: errorResponse('Administrator access is required.'),
  }
}
