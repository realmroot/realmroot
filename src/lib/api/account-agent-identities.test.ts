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

import { approveAgentEnrollment, deleteAgent, getAgentEnrollment } from '@/lib/api/account'

afterEach(() => {
  vi.restoreAllMocks()
  api.readJsonResponse.mockClear()
})

describe('Agent identity account API', () => {
  it('reads and approves encoded Agent enrollments', async () => {
    const requests: Array<{ url: string; method: string; credentials: RequestCredentials | undefined }> = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        credentials: init?.credentials,
      })
      return Response.json(init?.method === 'PUT' ? { agent: { id: 'agent-1' } } : { id: 'enrollment-1' })
    })

    await getAgentEnrollment('intent/with space')
    await expect(approveAgentEnrollment('intent/with space')).resolves.toEqual({
      agent: { id: 'agent-1' },
    })

    expect(requests).toEqual([
      {
        url: '/api/account/agent-enrollments/intent%2Fwith%20space',
        method: 'GET',
        credentials: 'same-origin',
      },
      {
        url: '/api/account/agent-enrollments/intent%2Fwith%20space/decision',
        method: 'PUT',
        credentials: 'same-origin',
      },
    ])
  })

  it('deletes successfully and delegates error parsing for a failed response', async () => {
    vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ error: 'already deleted' }, { status: 400 }))

    await expect(deleteAgent('agent/1')).resolves.toBeUndefined()
    await expect(deleteAgent('agent/1')).resolves.toEqual({ error: 'already deleted' })
    expect(window.fetch).toHaveBeenCalledWith('/api/account/agents/agent%2F1', {
      method: 'DELETE',
      credentials: 'same-origin',
    })
    expect(api.readJsonResponse).toHaveBeenCalledTimes(1)
  })
})
