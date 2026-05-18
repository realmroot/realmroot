import { describe, expect, it } from 'vitest'
import {
  listApplicationsResponseSchema,
  listClientSecretsResponseSchema,
  listRedirectUrisResponseSchema,
  paginationQuerySchema,
} from './applications'

describe('application API pagination contracts', () => {
  it('parses pagination query defaults and numeric query strings', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 })
    expect(paginationQuerySchema.parse({ limit: '25', offset: '50' })).toEqual({ limit: 25, offset: 50 })
    expect(() => paginationQuerySchema.parse({ limit: '101' })).toThrow()
    expect(() => paginationQuerySchema.parse({ offset: '-1' })).toThrow()
  })

  it('requires collection responses to include pagination metadata', () => {
    const pagination = {
      limit: 10,
      offset: 0,
      total: 0,
      hasMore: false,
      nextOffset: null,
    }

    expect(listApplicationsResponseSchema.parse({ applications: [], pagination })).toEqual({
      applications: [],
      pagination,
    })
    expect(listClientSecretsResponseSchema.parse({ secrets: [], pagination })).toEqual({ secrets: [], pagination })
    expect(listRedirectUrisResponseSchema.parse({ redirectUris: [], pagination })).toEqual({
      redirectUris: [],
      pagination,
    })
    expect(() => listApplicationsResponseSchema.parse({ applications: [] })).toThrow()
  })
})
