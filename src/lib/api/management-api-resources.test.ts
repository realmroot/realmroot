import { afterEach, describe, expect, it, vi } from 'vitest'
import { refreshApiResourceScopeRegistry } from './management-api-resources'

afterEach(() => vi.unstubAllGlobals())
describe('Resource Server client', () => {
  it('refreshes the canonical scope-registry child resource', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: 'resource/1' }))
    vi.stubGlobal('fetch', fetch)
    await refreshApiResourceScopeRegistry('resource/1')
    expect(fetch).toHaveBeenCalledWith('/api/resource-servers/resource%2F1/scope-registry', {
      method: 'PUT',
      credentials: 'same-origin',
    })
  })
})
