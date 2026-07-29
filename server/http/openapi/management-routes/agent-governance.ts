import {
  agentIdentityParam,
  agentTokenRequestSchema,
  agentTokenResponseSchema,
  jsonBody,
  listAgentAuditEventsResponseSchema,
  listAgentIdentityInventoryResponseSchema,
  type ManagementRouteConfig,
  paginationQuerySchema,
  requestAgentCapabilitiesResponseSchema,
  requestAgentCapabilitiesSchema,
  z,
} from './helpers'

export const agentGovernanceRoutes: ManagementRouteConfig[] = [
  {
    method: 'post',
    path: '/agent/oauth2/token',
    operationId: 'issueAgentAccessToken',
    summary: 'Issue a short-lived Agent authority token',
    security: [{ agentAuth: [] }],
    request: {
      headers: z.object({
        DPoP: z.string().openapi({ param: { name: 'DPoP', in: 'header' } }),
      }),
      body: jsonBody(agentTokenRequestSchema),
    },
    response: agentTokenResponseSchema,
  },
  {
    method: 'post',
    path: '/capability-requests',
    operationId: 'requestAgentCapabilities',
    summary: 'Request additional Agent capabilities',
    request: { body: jsonBody(requestAgentCapabilitiesSchema) },
    response: requestAgentCapabilitiesResponseSchema,
  },
  {
    method: 'get',
    path: '/agents/identity-inventory',
    operationId: 'listAgentIdentityInventory',
    summary: 'List stable Agent identities',
    request: { query: paginationQuerySchema },
    response: listAgentIdentityInventoryResponseSchema,
  },
  {
    method: 'get',
    path: '/agent-audit-events',
    operationId: 'listAgentAuditEvents',
    summary: 'List Agent audit events',
    request: { query: paginationQuerySchema },
    response: listAgentAuditEventsResponseSchema,
  },
  {
    method: 'delete',
    path: '/agent-identities/{identityId}',
    operationId: 'retireAgentIdentity',
    summary: 'Emergency retire an Agent identity',
    request: { params: agentIdentityParam },
    noBody: true,
  },
]
