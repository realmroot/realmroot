import { describe, expect, it } from 'vitest'

import { paginationMetadataSchema, repositoryPageQuery } from './pagination'

describe('page pagination contract', () => {
  it('converts the public page profile to repository limit and offset without leaking public fields', () => {
    expect(repositoryPageQuery({ page: 3, pageSize: 25, status: 'active' })).toEqual({
      limit: 25,
      offset: 50,
      status: 'active',
    })
  })

  it('requires totalPages to match the exact collection total', () => {
    expect(paginationMetadataSchema.parse({ page: 2, pageSize: 25, totalItems: 80, totalPages: 4 })).toEqual({
      page: 2,
      pageSize: 25,
      totalItems: 80,
      totalPages: 4,
    })
    expect(() => paginationMetadataSchema.parse({ page: 2, pageSize: 25, totalItems: 80, totalPages: 3 })).toThrow(
      'totalPages must equal ceil(totalItems / pageSize).',
    )
  })
})
