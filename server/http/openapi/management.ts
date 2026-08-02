import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import {
  accessGrantSchema,
  accessGrantsResponseSchema,
  accessRequestSchema,
  agentApiResourcesResponseSchema,
  agentEnrollmentResponseSchema,
  agentEnrollmentSchema,
  agentResponseSchema,
  createAccessRequestSchema,
  createAgentEnrollmentSchema,
  targetTokenSchema,
} from '@shared/api/agent-api'
import { protectedResourceCapabilityNames, requiredProtectedCapability } from '@shared/authz'
import { z } from 'zod'
import { agentGovernanceRoutes } from './management-routes/agent-governance'
import { applicationAuthorizationRoutes } from './management-routes/applications-authorization'
import {
  errorResponse,
  jsonBody,
  jsonContentType,
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
    summary: 'Create or extend the current stable Agent',
    security: [{ agentAuth: [] }],
    request: { body: jsonBody(createAgentEnrollmentSchema) },
    response: z.union([agentResponseSchema, agentEnrollmentResponseSchema]),
    status: 201,
  },
  {
    method: 'get',
    path: '/agent/enrollments/{enrollmentId}',
    operationId: 'getAgentEnrollment',
    summary: 'Read an Agent enrollment',
    security: [{ agentAuth: [] }],
    request: { params: z.object({ enrollmentId: z.string() }) },
    response: agentEnrollmentSchema,
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
  app.openAPIRegistry.registerComponent('securitySchemes', 'adminSession', {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
    description: 'Authenticated administrator session.',
  })
  app.openAPIRegistry.registerComponent('securitySchemes', 'agentAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'agent+jwt',
    description: 'AgentAuth possession proof supplied transparently by the Realmroot Restish authentication adapter.',
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
    security:
      routeConfig.security ??
      (requiredAgentCapability
        ? [{ agentAuth: [requiredAgentCapability] }, { adminSession: ['admin'] }]
        : managementSecurity),
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
