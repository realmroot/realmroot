import { agentResponseSchema, agentsResponseSchema, auditEventsResponseSchema } from '@shared/api/agent-api'
import {
  agentTokenFormSchema,
  agentTokenResponseSchema,
  jsonBody,
  type ManagementRouteConfig,
  paginationQuerySchema,
  requestAgentCapabilitiesResponseSchema,
  requestAgentCapabilitiesSchema,
  z,
} from './helpers'

export const agentGovernanceRoutes: ManagementRouteConfig[] = [
  {
    method: 'post',
    path: '/auth/oauth2/token',
    operationId: 'issueAgentAccessToken',
    summary: 'Issue a short-lived Agent authority token',
    security: [{ agentAuth: [] }],
    request: {
      headers: z.object({
        DPoP: z.string().openapi({ param: { name: 'DPoP', in: 'header' } }),
      }),
      body: {
        content: {
          'application/x-www-form-urlencoded': {
            schema: agentTokenFormSchema,
          },
        },
      },
    },
    response: agentTokenResponseSchema,
  },
  {
    method: 'post',
    path: '/agent/management-access-requests',
    operationId: 'requestAgentManagementAccess',
    summary: 'Request FlareAuth management access',
    security: [{ agentAuth: [] }],
    request: { body: jsonBody(requestAgentCapabilitiesSchema) },
    response: requestAgentCapabilitiesResponseSchema,
  },
  {
    method: 'get',
    path: '/management/agents',
    operationId: 'listAgents',
    summary: 'List stable Agents',
    request: { query: paginationQuerySchema },
    response: agentsResponseSchema,
  },
  {
    method: 'get',
    path: '/management/agents/{agentId}',
    operationId: 'getAgent',
    summary: 'Get a stable Agent',
    request: { params: z.object({ agentId: z.string() }) },
    response: agentResponseSchema,
  },
  {
    method: 'delete',
    path: '/management/agents/{agentId}',
    operationId: 'retireAgent',
    summary: 'Permanently retire an Agent',
    request: { params: z.object({ agentId: z.string() }) },
    noBody: true,
  },
  {
    method: 'get',
    path: '/management/audit-events',
    operationId: 'listAgentAuditEvents',
    summary: 'List Agent audit events',
    request: { query: paginationQuerySchema },
    response: auditEventsResponseSchema,
  },
]
