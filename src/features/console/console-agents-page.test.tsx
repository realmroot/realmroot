import { cleanup, fireEvent, screen } from '@testing-library/react'
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
      const url = new URL(request?.url ?? String(input), window.location.origin).pathname
      const method = request?.method ?? init?.method ?? 'GET'
      requests.push({ url, method })
      if (url === '/api/agents') return Promise.resolve(jsonResponse(agentInventory))
      throw new Error(`Unexpected request: ${method} ${url}`)
    })

    renderWithQuery(<AgentsPage />)

    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeTruthy()
    expect(await screen.findByText('Stable Build Agent')).toBeTruthy()
    expect(screen.getByText('Retired Personal Agent')).toBeTruthy()
    expect(screen.getByText('Acme Engineering')).toBeTruthy()
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('org-1')).toBeTruthy()
    expect(screen.getByText('user-2')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /create|new/i })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search Agents' }), { target: { value: 'retired' } })
    expect(screen.queryByText('Stable Build Agent')).toBeNull()
    expect(screen.getByText('Retired Personal Agent')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search Agents' }), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filter owner type'), { target: { value: 'organization' } })
    expect(screen.getByText('Stable Build Agent')).toBeTruthy()
    expect(screen.queryByText('Retired Personal Agent')).toBeNull()
    fireEvent.change(screen.getByLabelText('Filter owner type'), { target: { value: 'any' } })
    fireEvent.change(screen.getByLabelText('Filter Agent status'), { target: { value: 'retired' } })
    expect(screen.queryByText('Stable Build Agent')).toBeNull()
    expect(screen.getByText('Retired Personal Agent')).toBeTruthy()
    expect(requests).toEqual([{ url: '/api/agents', method: 'GET' }])
    expect(requests.some(({ url }) => url.includes('host') || url.includes('binding'))).toBe(false)
  })

  it('surfaces an inventory failure and retries the Agent dataset', async () => {
    let failed = true
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const request = input instanceof Request ? input : null
      const url = new URL(request?.url ?? String(input), window.location.origin).pathname
      requests.push(url)
      if (failed) return Promise.resolve(jsonResponse({ error: 'offline' }, 500))
      if (url === '/api/agents') return Promise.resolve(jsonResponse(agentInventory))
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(<AgentsPage />)
    expect(await screen.findByText('offline')).toBeTruthy()
    failed = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Stable Build Agent')).toBeTruthy()
    expect(requests.filter((url) => url === '/api/agents').length).toBeGreaterThan(1)
  })

  it('renders an empty Agent inventory', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const request = input instanceof Request ? input : null
      const url = new URL(request?.url ?? String(input), window.location.origin).pathname
      if (url === '/api/agents') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(<AgentsPage />)

    expect(await screen.findByText('No Agents found')).toBeTruthy()
    expect(screen.getByText('Agents appear after enrollment approval.')).toBeTruthy()
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
      owner: { id: 'org-1', type: 'organization', displayName: 'Acme Engineering' },
      status: 'active',
      retiredAt: null,
      installationCount: 1,
      roleCount: 2,
      pendingRequestCount: 1,
      activeGrantCount: 3,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'agent-2',
      issuer: 'https://auth.example.com',
      subject: 'agt_retired',
      name: 'Retired Personal Agent',
      homeSpace: { type: 'personal', userId: 'user-2' },
      owner: { id: 'user-2', type: 'user', displayName: 'Ada Lovelace' },
      status: 'retired',
      retiredAt: timestamp,
      installationCount: 0,
      roleCount: 0,
      pendingRequestCount: 0,
      activeGrantCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  pagination: { ...emptyPagination, total: 2 },
}
