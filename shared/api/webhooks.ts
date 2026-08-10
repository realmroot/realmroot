import { z } from 'zod'
import { paginationMetadataSchema, paginationQuerySchema } from './applications'
import { uuidV7Schema } from './identifiers'

export { idempotencyKeySchema } from './idempotency'

export const webhookEvents = [
  'user.created',
  'user.updated',
  'user.deleted',
  'session.created',
  'session.revoked',
  'application.created',
  'application.updated',
] as const

export const webhookEventSchema = z.enum(webhookEvents)

export const webhookEndpointStatusSchema = z.enum(['enabled', 'disabled'])
export const webhookRequestStatusSchema = z.enum(['pending', 'delivered', 'failed'])
export const webhookDeliveryAttemptStatusSchema = z.enum(['pending', 'delivered', 'failed'])

const webhookEndpointUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => value.startsWith('https://'), 'Endpoint URL must use https.')

export const webhookEndpointSchema = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(webhookEventSchema).min(1),
  enabled: z.boolean(),
  organizationId: z.string().nullable(),
  secretPrefix: z.string(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
})

export const listWebhookEndpointsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().optional(),
  status: webhookEndpointStatusSchema.optional(),
  organizationId: z.string().trim().optional(),
})

export const createWebhookEndpointRequestSchema = z.object({
  url: webhookEndpointUrlSchema,
  events: z.array(webhookEventSchema).min(1),
  enabled: z.boolean().default(true),
  organizationId: z.string().nullable(),
})

export const updateWebhookEndpointRequestSchema = z
  .object({
    url: webhookEndpointUrlSchema.optional(),
    events: z.array(webhookEventSchema).min(1).optional(),
    enabled: z.boolean().optional(),
    organizationId: z.string().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.')

export const listWebhookEndpointsResponseSchema = z.object({
  endpoints: z.array(webhookEndpointSchema),
  pagination: paginationMetadataSchema,
})

export const webhookEndpointSecretResponseSchema = z.object({
  endpoint: webhookEndpointSchema,
  signingSecret: z.string(),
})

export const webhookEventEnvelopeSchema = z.object({
  id: z.union([uuidV7Schema, z.string().startsWith('evt_')]),
  type: webhookEventSchema,
  createdAt: z.string().datetime(),
  data: z.record(z.string(), z.unknown()),
})

export const webhookRequestSchema = z.object({
  id: z.string(),
  endpointId: z.string(),
  endpointUrl: z.string(),
  organizationId: z.string().nullable(),
  event: webhookEventSchema,
  status: webhookRequestStatusSchema,
  attemptCount: z.number().int().min(0),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  error: z.string().nullable(),
  requestBody: z.string().nullable(),
  responseBody: z.string().nullable(),
  nextAttemptAt: z.union([z.string(), z.date()]).nullable(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
})

export const listWebhookRequestsQuerySchema = paginationQuerySchema.extend({
  endpointId: z.string().trim().optional(),
  organizationId: z.string().trim().optional(),
  search: z.string().trim().optional(),
  status: webhookRequestStatusSchema.optional(),
})

export const listWebhookRequestsResponseSchema = z.object({
  requests: z.array(webhookRequestSchema),
  pagination: paginationMetadataSchema,
})

export const webhookDeliveryAttemptSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  sequence: z.number().int().positive(),
  status: webhookDeliveryAttemptStatusSchema,
  httpStatus: z.number().int().min(100).max(599).nullable(),
  error: z.string().nullable(),
  responseBody: z.string().nullable(),
  createdAt: z.union([z.string(), z.date()]),
  completedAt: z.union([z.string(), z.date()]).nullable(),
})

export const listWebhookDeliveryAttemptsQuerySchema = paginationQuerySchema

export const listWebhookDeliveryAttemptsResponseSchema = z.object({
  attempts: z.array(webhookDeliveryAttemptSchema),
  pagination: paginationMetadataSchema,
})

export type WebhookEvent = z.infer<typeof webhookEventSchema>
export type WebhookRequestStatus = z.infer<typeof webhookRequestStatusSchema>
export type WebhookDeliveryAttemptStatus = z.infer<typeof webhookDeliveryAttemptStatusSchema>
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>
export type WebhookRequest = z.infer<typeof webhookRequestSchema>
export type ListWebhookEndpointsQuery = z.infer<typeof listWebhookEndpointsQuerySchema>
export type CreateWebhookEndpointRequest = z.infer<typeof createWebhookEndpointRequestSchema>
export type UpdateWebhookEndpointRequest = z.infer<typeof updateWebhookEndpointRequestSchema>
export type ListWebhookEndpointsResponse = z.infer<typeof listWebhookEndpointsResponseSchema>
export type WebhookEndpointSecretResponse = z.infer<typeof webhookEndpointSecretResponseSchema>
export type WebhookEventEnvelope = z.infer<typeof webhookEventEnvelopeSchema>
export type ListWebhookRequestsQuery = z.infer<typeof listWebhookRequestsQuerySchema>
export type ListWebhookRequestsResponse = z.infer<typeof listWebhookRequestsResponseSchema>
export type WebhookDeliveryAttempt = z.infer<typeof webhookDeliveryAttemptSchema>
export type ListWebhookDeliveryAttemptsResponse = z.infer<typeof listWebhookDeliveryAttemptsResponseSchema>
