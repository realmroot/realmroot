import { z } from 'zod'

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

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
    nextOffset,
  }
}
