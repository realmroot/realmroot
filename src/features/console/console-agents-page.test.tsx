import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentsPage } from '@/features/agents/management-agents-page'
import { queryClient } from '@/router'
import { emptyPagination, jsonResponse, renderWithQuery } from './console.test-utils'

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
})

describe('console Agents page', () => {
  it('binds Organization Workspace Agent inventory and links to its Organization [spec: admin-console/organization-console-resource-boundary]', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const request = input instanceof Request ? input : null
      const url = new URL(request?.url ?? String(input), window.location.origin)
      requests.push(`${url.pathname}${url.search}`)
      if (url.pathname === '/api/agents') return Promise.resolve(jsonResponse(agentInventory))
      throw new Error(`Unexpected request: ${url.pathname}${url.search}`)
    })

    renderWithQuery(<AgentsPage organizationId="org-1" />)

    const agentLink = await screen.findByRole('link', { name: 'Open Stable Build Agent' })
    expect(agentLink.getAttribute('href')).toBe('/organizations/org-1/agents/agent-1')
    expect(screen.queryByLabelText('Filter owner type')).toBeNull()
    expect(requests).toEqual(['/api/agents?organizationId=org-1'])
  })

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
    expect(screen.getByText('Inactive Personal Agent')).toBeTruthy()
    expect(screen.getByText('Acme Engineering')).toBeTruthy()
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('org-1')).toBeTruthy()
    expect(screen.getByText('user-2')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /create|new/i })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search Agents' }), { target: { value: 'inactive' } })
    expect(screen.queryByText('Stable Build Agent')).toBeNull()
    expect(screen.getByText('Inactive Personal Agent')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search Agents' }), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filter owner type'), { target: { value: 'organization' } })
    expect(screen.getByText('Stable Build Agent')).toBeTruthy()
    expect(screen.queryByText('Inactive Personal Agent')).toBeNull()
    fireEvent.change(screen.getByLabelText('Filter owner type'), { target: { value: 'any' } })
    fireEvent.change(screen.getByLabelText('Filter Agent status'), { target: { value: 'inactive' } })
    expect(screen.queryByText('Stable Build Agent')).toBeNull()
    expect(screen.getByText('Inactive Personal Agent')).toBeTruthy()
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
      username: 'stable-build-agent.0000000000000000000000000000000b',
      name: 'Stable Build Agent',
      homeSpace: { type: 'organization', organizationId: 'org-1' },
      owner: { id: 'org-1', type: 'organization', displayName: 'Acme Engineering' },
      status: 'active',
      installationCount: 1,
      pendingRequestCount: 1,
      activeScopeCount: 3,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'agent-2',
      issuer: 'https://auth.example.com',
      subject: 'agt_inactive',
      name: 'Inactive Personal Agent',
      homeSpace: { type: 'personal', userId: 'user-2' },
      owner: { id: 'user-2', type: 'user', displayName: 'Ada Lovelace' },
      status: 'inactive',
      installationCount: 0,
      pendingRequestCount: 0,
      activeScopeCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  pagination: { ...emptyPagination, total: 2 },
}
