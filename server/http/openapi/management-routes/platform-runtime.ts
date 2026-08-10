import {
  agentEnrollmentSchema,
  agentInstallationEnrollmentResponseSchema,
  agentInstallationEnrollmentSchema,
  createAgentSelfEnrollmentSchema,
} from '@shared/api/agent-api'
import { jsonBody, locationResponseHeader, type ManagementRouteConfig, z } from './helpers'

export const platformRuntimeRoutes: ManagementRouteConfig[] = [
  {
    method: 'post',
    path: '/agent/enrollments',
    operationId: 'createAgentEnrollment',
    summary: 'Create an Agent identity or installation enrollment',
    security: [{ agentAssertion: [] }],
    request: {
      headers: z.object({
        'Idempotency-Key': z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .openapi({ param: { name: 'Idempotency-Key', in: 'header' } }),
      }),
      body: jsonBody(createAgentSelfEnrollmentSchema),
    },
    response: z.union([agentEnrollmentSchema, agentInstallationEnrollmentResponseSchema]),
    status: 201,
    responseHeaders: {
      ...locationResponseHeader,
      'Idempotency-Replayed': {
        description: 'True when an additional-installation enrollment replays an existing idempotent result.',
        schema: { type: 'string', enum: ['true'] },
      },
    },
    errors: {
      400: 'The enrollment representation or required idempotency key is invalid.',
    },
  },
  {
    method: 'get',
    path: '/agent/enrollments/{enrollmentId}',
    operationId: 'getAgentEnrollment',
    summary: 'Get an Agent installation enrollment',
    security: [{ agentAssertion: [] }],
    request: { params: z.object({ enrollmentId: z.string() }) },
    response: agentInstallationEnrollmentSchema,
    errors: { 404: 'The Agent enrollment was not found.' },
  },
]
