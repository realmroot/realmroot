import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import {
  agentAccessRequestSchema,
  agentResourceDiscoverySchema,
  createAgentAccessRequestSchema,
  createExternalTokenLeaseRequestSchema,
  externalTokenLeaseSchema,
} from '@shared/api/external-resources'
import { z } from 'zod'
import { agentGovernanceRoutes } from './management-routes/agent-governance'
import { applicationAuthorizationRoutes } from './management-routes/applications-authorization'
import {
  agentProtocolIdentityResponseSchema,
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
    path: '/whoami',
    operationId: 'whoami',
    summary: 'Read the current Agent identity',
    security: [{ agentAuth: [] }],
    response: agentProtocolIdentityResponseSchema,
  },
  {
    method: 'get',
    path: '/agent/resources',
    operationId: 'listAgentResources',
    summary: 'Discover connected external API resources',
    security: [{ agentAuth: [] }],
    response: agentResourceDiscoverySchema,
  },
  {
    method: 'post',
    path: '/agent/access-requests',
    operationId: 'requestAgentResourceAccess',
    summary: 'Request exact external API resource access',
    security: [{ agentAuth: [] }],
    request: { body: jsonBody(createAgentAccessRequestSchema) },
    response: agentAccessRequestSchema,
    status: 201,
  },
  {
    method: 'get',
    path: '/agent/access-requests/{requestId}',
    operationId: 'getAgentResourceAccessRequest',
    summary: 'Read an external API resource access request',
    security: [{ agentAuth: [] }],
    request: { params: z.object({ requestId: z.string() }) },
    response: agentAccessRequestSchema,
  },
  {
    method: 'post',
    path: '/agent/access-requests/{requestId}/token-leases',
    operationId: 'issueExternalResourceTokenLease',
    summary: 'Issue a target-platform DPoP token lease',
    security: [{ agentAuth: [] }],
    request: {
      params: z.object({ requestId: z.string() }),
      body: jsonBody(createExternalTokenLeaseRequestSchema),
    },
    response: externalTokenLeaseSchema,
    status: 201,
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
    description: 'AgentAuth possession proof supplied transparently by the FlareAuth Restish authentication adapter.',
  })
  for (const routeConfig of managementRoutes) app.openAPIRegistry.registerPath(createManagementRoute(routeConfig))
  return app
}

function buildUnifiedOpenApi(): UnifiedOpenApiDocument {
  const document = openApiApp.getOpenAPI31Document(
    {
      openapi: '3.1.0',
      info: {
        title: 'FlareAuth API',
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
                  provider: 'flareauth-agent',
                },
              },
              params: {
                provider: 'flareauth-agent',
              },
            },
          },
        },
      },
    },
  } as UnifiedOpenApiDocument
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
  if (routeConfig.noBody) responses[routeConfig.status ?? 204] = { description: routeConfig.summary }
  else
    responses[routeConfig.status ?? 200] = {
      description: routeConfig.summary,
      content: { [jsonContentType]: { schema: routeConfig.response } },
    }
  if (routeConfig.security !== undefined && routeConfig.security.length === 0) return responses
  return {
    ...responses,
    401: errorResponse('Authentication is required.'),
    403: errorResponse('Administrator access is required.'),
  }
}
