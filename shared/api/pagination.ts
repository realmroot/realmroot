import { z } from 'zod'

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

// The single source of truth for collection pagination metadata, matching what
// `paginationMetadata()` below emits. Resource schemas import this instead of
// redeclaring it.
export const paginationMetadataSchema = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().min(0),
    totalPages: z.number().int().min(0),
  })
  .superRefine((pagination, context) => {
    if (pagination.totalPages !== Math.ceil(pagination.totalItems / pagination.pageSize)) {
      context.addIssue({
        code: 'custom',
        path: ['totalPages'],
        message: 'totalPages must equal ceil(totalItems / pageSize).',
      })
    }
  })

export type PaginationMetadata = z.infer<typeof paginationMetadataSchema>
export type PaginationQuery = z.infer<typeof paginationQuerySchema>

export interface PaginationInput {
  limit: number
  offset: number
}

export interface PaginatedResult<T> extends PaginationInput {
  items: T[]
  total: number
}

export function paginationMetadata(page: PaginationInput & { total: number }) {
  return {
    page: Math.floor(page.offset / page.limit) + 1,
    pageSize: page.limit,
    totalItems: page.total,
    totalPages: Math.ceil(page.total / page.limit),
  }
}

export function paginationInput(query: PaginationQuery): PaginationInput {
  return {
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  }
}

export function repositoryPageQuery<T extends PaginationQuery>(
  query: T,
): Omit<T, keyof PaginationQuery> & PaginationInput {
  const { page, pageSize, ...filters } = query
  return {
    ...filters,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  }
}
