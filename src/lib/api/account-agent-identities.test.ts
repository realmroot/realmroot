import { afterEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  readJsonResponse: vi.fn(async (response: Response) => response.json()),
}))

vi.mock('@/lib/api', () => ({
  apiClient: {},
  readJsonResponse: api.readJsonResponse,
  readRpcResponse: vi.fn(),
  uploadApiFile: vi.fn(),
}))
vi.mock('@/lib/auth-client', () => ({ nativeAuth: vi.fn() }))

import {
  approveAgentEnrollmentIntent,
  getAgentEnrollmentIntent,
  listPersonalAgentIdentities,
  retirePersonalAgentIdentity,
} from '@/lib/api/account'

afterEach(() => {
  vi.restoreAllMocks()
  api.readJsonResponse.mockClear()
})

describe('Agent identity account API', () => {
  it('lists identities and reads and approves encoded enrollment intents', async () => {
    const requests: Array<{ url: string; method: string; credentials: RequestCredentials | undefined }> = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        credentials: init?.credentials,
      })
      return Response.json(
        String(input).includes('approvals') ? { identity: { id: 'identity-1' } } : { identities: [] },
      )
    })

    await expect(listPersonalAgentIdentities()).resolves.toEqual({ identities: [] })
    await getAgentEnrollmentIntent('intent/with space')
    await expect(approveAgentEnrollmentIntent('intent/with space')).resolves.toEqual({
      identity: { id: 'identity-1' },
    })

    expect(requests).toEqual([
      { url: '/api/account/agent-identities', method: 'GET', credentials: 'same-origin' },
      {
        url: '/api/account/agent-enrollment-intents/intent%2Fwith%20space',
        method: 'GET',
        credentials: 'same-origin',
      },
      {
        url: '/api/account/agent-enrollment-intents/intent%2Fwith%20space/approvals',
        method: 'POST',
        credentials: 'same-origin',
      },
    ])
  })

  it('retires successfully and delegates error parsing for a failed response', async () => {
    vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ error: 'already retired' }, { status: 400 }))

    await expect(retirePersonalAgentIdentity('identity/1')).resolves.toBeUndefined()
    await expect(retirePersonalAgentIdentity('identity/1')).resolves.toEqual({ error: 'already retired' })
    expect(window.fetch).toHaveBeenCalledWith('/api/account/agent-identities/identity%2F1', {
      method: 'DELETE',
      credentials: 'same-origin',
    })
    expect(api.readJsonResponse).toHaveBeenCalledTimes(1)
  })
})
