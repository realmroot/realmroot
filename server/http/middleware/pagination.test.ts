import { describe, expect, it } from 'vitest'
import { paginationLinkHeader, responsePagination } from './pagination'

describe('pagination response metadata', () => {
  it('reads the standard page profile from JSON collection responses', async () => {
    const response = Response.json({
      items: [],
      pagination: { page: 2, pageSize: 25, totalItems: 80, totalPages: 4 },
    })

    await expect(responsePagination(response)).resolves.toEqual({
      page: 2,
      pageSize: 25,
      totalItems: 80,
      totalPages: 4,
    })
  })

  it('ignores JSON responses that are not paginated collections', async () => {
    await expect(responsePagination(Response.json({ item: {} }))).resolves.toBeNull()
    await expect(
      responsePagination(new Response(null, { headers: { 'content-type': 'application/json' } })),
    ).resolves.toBeNull()
  })
})

describe('pagination Link header', () => {
  it('preserves filters and emits all applicable absolute navigation URLs', () => {
    expect(
      paginationLinkHeader('https://id.example/api/agents?status=active&page=2&pageSize=25', {
        page: 2,
        pageSize: 25,
        totalItems: 80,
        totalPages: 4,
      }),
    ).toBe(
      '<https://id.example/api/agents?status=active&page=1&pageSize=25>; rel="first", ' +
        '<https://id.example/api/agents?status=active&page=1&pageSize=25>; rel="previous", ' +
        '<https://id.example/api/agents?status=active&page=3&pageSize=25>; rel="next", ' +
        '<https://id.example/api/agents?status=active&page=4&pageSize=25>; rel="last"',
    )
  })

  it('omits navigation when the collection has no applicable page', () => {
    expect(
      paginationLinkHeader('https://id.example/api/agents?page=1&pageSize=50', {
        page: 1,
        pageSize: 50,
        totalItems: 0,
        totalPages: 0,
      }),
    ).toBeNull()
  })
})
