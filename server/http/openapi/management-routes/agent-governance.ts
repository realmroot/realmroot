import { agentResponseSchema, agentsResponseSchema, auditEventsResponseSchema } from '@shared/api/agent-api'
import {
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
    path: '/agent/capability-requests',
    operationId: 'requestAgentCapabilities',
    summary: 'Request Realmroot resource capabilities',
    security: [{ agentAuth: [] }],
    request: { body: jsonBody(requestAgentCapabilitiesSchema) },
    response: requestAgentCapabilitiesResponseSchema,
  },
  {
    method: 'get',
    path: '/agents',
    operationId: 'listAgents',
    summary: 'List stable Agents',
    request: { query: paginationQuerySchema },
    response: agentsResponseSchema,
  },
  {
    method: 'get',
    path: '/agents/{agentId}',
    operationId: 'getAgent',
    summary: 'Get a stable Agent',
    request: { params: z.object({ agentId: z.string() }) },
    response: agentResponseSchema,
  },
  {
    method: 'delete',
    path: '/agents/{agentId}',
    operationId: 'retireAgent',
    summary: 'Permanently retire an Agent',
    request: { params: z.object({ agentId: z.string() }) },
    noBody: true,
  },
  {
    method: 'get',
    path: '/audit-events',
    operationId: 'listAgentAuditEvents',
    summary: 'List Agent audit events',
    request: { query: paginationQuerySchema },
    response: auditEventsResponseSchema,
  },
]
