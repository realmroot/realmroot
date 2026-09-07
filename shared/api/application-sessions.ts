import { z } from 'zod'
import { paginationMetadataSchema, paginationQuerySchema } from './pagination'

export const applicationSessionsQuerySchema = paginationQuerySchema.extend({ client_id: z.string().min(1).max(256) })
export const applicationSessionSchema = z.object({
  id: z.string(),
  createdAt: z.string().datetime(),
  lastActiveAt: z.string().datetime(),
  userAgent: z.string().nullable(),
  legacy: z.boolean(),
  identified: z.boolean(),
  deviceName: z.string().nullable(),
  devicePlatform: z.string().nullable(),
})
export const applicationSessionsResponseSchema = z.object({
  application: z.object({ clientId: z.string(), name: z.string() }),
  items: z.array(applicationSessionSchema),
  pagination: paginationMetadataSchema,
  summary: z.object({ devices: z.number().int().min(0), unidentifiedSessions: z.number().int().min(0) }),
})
export type ApplicationSession = z.infer<typeof applicationSessionSchema>
export type ApplicationSessionsResponse = z.infer<typeof applicationSessionsResponseSchema>
