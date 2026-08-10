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
    cli: { group: 'Agent', name: 'enroll' },
    security: [{ agentAssertion: [] }],
    request: {
      headers: z.object({
        'Idempotency-Key': z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .openapi({
            description:
              'Stable retry key injected by the Agent authentication adapter; direct clients must supply it.',
            param: { name: 'Idempotency-Key', in: 'header' },
          }),
      }),
      body: { ...jsonBody(createAgentSelfEnrollmentSchema), required: false },
    },
    response: z.union([agentEnrollmentSchema, agentInstallationEnrollmentResponseSchema]),
    status: 201,
    responseHeaders: {
      ...locationResponseHeader,
      Link: {
        description: 'Declares the Agent enrollment response profile used to complete local identity state.',
        schema: { type: 'string' },
      },
      'Idempotency-Replayed': {
        description: 'True when an enrollment replays an existing idempotent result.',
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
