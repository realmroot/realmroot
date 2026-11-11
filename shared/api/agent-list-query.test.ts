import { describe, expect, it } from 'vitest'
import { listAccountAgentsQuerySchema, listAgentsQuerySchema } from './agent-api'

describe('Agent collection query boundaries', () => {
  it('validates owner filters and pagination for management', () => {
    expect(listAgentsQuerySchema.parse({ ownerUserId: 'owner', page: '2' })).toMatchObject({
      ownerUserId: 'owner',
      page: 2,
    })
    for (const query of [{ ownerUserId: '' }, { ownerUserId: ' ' }, { page: '0' }, { pageSize: '101' }]) {
      expect(listAgentsQuerySchema.safeParse(query).success).toBe(false)
    }
  })

  it('validates account sorting and rejects owner selection', () => {
    expect(listAccountAgentsQuerySchema.parse({ sortBy: 'name', sortDirection: 'desc' })).toMatchObject({
      sortBy: 'name',
      sortDirection: 'desc',
    })
    for (const query of [
      { ownerUserId: 'other' },
      { sortBy: 'status' },
      { sortDirection: 'sideways' },
      { page: '-1' },
    ]) {
      expect(listAccountAgentsQuerySchema.safeParse(query).success).toBe(false)
    }
  })
})
