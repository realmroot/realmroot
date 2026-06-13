import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { systemCliClientId } from '@shared/api/applications'
import { applicationAuthorizationRoutes } from './management-routes/applications-authorization'
import {
  errorResponse,
  jsonContentType,
  type ManagementRouteConfig,
  managementScopes,
  managementSecurity,
} from './management-routes/helpers'
import { platformWebhookRoutes } from './management-routes/platform-webhooks'
import { userSecurityRoutes } from './management-routes/users-security'

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
  'x-cli-config': { security: string; params: RestishCliConfigParams }
  [key: string]: unknown
}
type RestishCliConfigParams = Record<string, string>

export const managementOpenApiPath = '/api/management/openapi.json'
export const managementOpenApiLinkHeader = [
  `<${managementOpenApiPath}>; rel="service-desc"; type="application/openapi+json"`,
  `<${managementOpenApiPath}>; rel="describedby"; type="application/openapi+json"`,
].join(', ')

const managementRoutes: ManagementRouteConfig[] = [
  ...applicationAuthorizationRoutes,
  ...userSecurityRoutes,
  ...platformWebhookRoutes,
]
const openApiApp = createManagementOpenApiApp()
export const managementOpenApi = buildManagementOpenApi()

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
  for (const routeConfig of managementRoutes) app.openAPIRegistry.registerPath(createManagementRoute(routeConfig))
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
