import { z } from 'zod'

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

// The single source of truth for collection pagination metadata, matching what
// `paginationMetadata()` below emits. Resource schemas import this instead of
// redeclaring it.
export const paginationMetadataSchema = z.object({
  limit: z.number().int().positive(),
  offset: z.number().int().min(0),
  total: z.number().int().min(0),
  hasMore: z.boolean(),
  nextOffset: z.number().int().min(0).nullable(),
})

export type PaginationMetadata = z.infer<typeof paginationMetadataSchema>

export interface PaginationInput {
  limit: number
  offset: number
}

export interface PaginatedResult<T> extends PaginationInput {
  items: T[]
  total: number
}

export function paginationMetadata(page: PaginationInput & { total: number }) {
  const nextOffset = page.offset + page.limit < page.total ? page.offset + page.limit : null

  return {
    limit: page.limit,
    offset: page.offset,
    total: page.total,
    hasMore: nextOffset !== null,
    nextOffset,
  }
}
