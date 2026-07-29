import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentsPage } from '@/features/console/pages/agents-page'
import { queryClient } from '@/router'
import { emptyPagination, jsonResponse, renderWithQuery } from './console.test-utils'

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
})

describe('console Agents page', () => {
  it(`governs stable Agents without exposing protocol implementation records
      [spec: admin-console/admin-agent-inventory]
      [spec: agent-identity/agent-governance-surfaces]`, async () => {
    const requests: Array<{ url: string; method: string }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = input instanceof Request ? input : null
      const url = request?.url ? new URL(request.url).pathname : String(input)
      const method = request?.method ?? init?.method ?? 'GET'
      requests.push({ url, method })
      if (url === '/api/management/agents') return Promise.resolve(jsonResponse(agentInventory))
      if (url === '/api/management/audit-events') return Promise.resolve(jsonResponse(agentAudit))
      if (url === '/api/management/agents/agent-1' && method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      throw new Error(`Unexpected request: ${method} ${url}`)
    })

    renderWithQuery(<AgentsPage />)

    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeTruthy()
    expect(await screen.findByText('Stable Build Agent')).toBeTruthy()
    expect(screen.getByText('Retired Personal Agent')).toBeTruthy()
    expect(screen.getByText('Organization org-1')).toBeTruthy()
    expect(screen.getByText('User user-2')).toBeTruthy()
    expect(screen.getByText('api_resource.token_issued')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Retire' })[0]!)
    await waitFor(() => expect(requests).toContainEqual({ url: '/api/management/agents/agent-1', method: 'DELETE' }))
    expect(requests.some(({ url }) => url.includes('host') || url.includes('binding'))).toBe(false)
  })

  it('renders empty Agent and audit tables', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const request = input instanceof Request ? input : null
      const url = request?.url ? new URL(request.url).pathname : String(input)
      if (url === '/api/management/agents') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/audit-events') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(<AgentsPage />)

    expect(await screen.findByText('No Agents.')).toBeTruthy()
    expect(screen.getByText('No Agent audit events.')).toBeTruthy()
  })
})

const timestamp = '2026-01-01T00:00:00.000Z'

const agentInventory = {
  items: [
    {
      id: 'agent-1',
      issuer: 'https://auth.example.com',
      subject: 'agt_stable',
      name: 'Stable Build Agent',
      homeSpace: { type: 'organization', organizationId: 'org-1' },
      status: 'active',
      retiredAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'agent-2',
      issuer: 'https://auth.example.com',
      subject: 'agt_retired',
      name: 'Retired Personal Agent',
      homeSpace: { type: 'personal', userId: 'user-2' },
      status: 'retired',
      retiredAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  pagination: { ...emptyPagination, total: 2 },
}

const agentAudit = {
  items: [
    {
      id: 'audit-1',
      action: 'api_resource.token_issued',
      result: 'allowed',
      controllerUserId: 'user-1',
      subjectIssuer: 'https://auth.example.com',
      subject: 'agt_stable',
      agentIdentityId: 'agent-1',
      hostId: null,
      resourceId: 'resource-1',
      resourceConnectionId: 'connection-1',
      accessGrantId: 'access-grant-1',
      scopes: ['projects:read'],
      reasonCode: null,
      metadata: {},
      occurredAt: timestamp,
    },
  ],
  pagination: { ...emptyPagination, total: 1 },
}
