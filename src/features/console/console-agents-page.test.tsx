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

describe('console delegated agents page', () => {
  it('renders AgentAuth inventory and revokes records through management RPCs', async () => {
    const requests: Array<{ url: string; method: string }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = input instanceof Request ? input : null
      const url = request?.url ? new URL(request.url).pathname : String(input)
      const method = request?.method ?? init?.method ?? 'GET'
      requests.push({ url, method })

      if (url === '/api/management/agents/protocol-inventory') {
        return Promise.resolve(jsonResponse(agentInventory))
      }
      const allowedDeleteUrls = [
        '/api/management/agents/agent-1',
        '/api/management/agent-hosts/host-1',
        '/api/management/agent-capability-grants/grant-1',
      ]
      if (allowedDeleteUrls.includes(url) && method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      throw new Error(`Unexpected request: ${method} ${url}`)
    })

    renderWithQuery(<AgentsPage />)

    expect(await screen.findByRole('heading', { name: 'Delegated agents' })).toBeTruthy()
    expect(await screen.findByText('Shell Host')).toBeTruthy()
    expect(screen.getByText('Build Agent')).toBeTruthy()
    expect(screen.getAllByText('account.profile.read').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('device_code')).toBeTruthy()

    for (const button of screen.getAllByRole('button', { name: 'Revoke' })) {
      fireEvent.click(button)
    }

    await waitFor(() => {
      expect(requests).toContainEqual({ url: '/api/management/agent-capability-grants/grant-1', method: 'DELETE' })
      expect(requests).toContainEqual({ url: '/api/management/agents/agent-1', method: 'DELETE' })
      expect(requests).toContainEqual({ url: '/api/management/agent-hosts/host-1', method: 'DELETE' })
    })
  })
})

const timestamp = '2026-01-01T00:00:00.000Z'

const agentInventory = {
  hosts: {
    items: [
      {
        id: 'host-1',
        name: 'Shell Host',
        userId: 'user-1',
        defaultCapabilities: 'account.profile.read',
        publicKey: null,
        kid: null,
        jwksUrl: null,
        enrollmentTokenExpiresAt: null,
        status: 'active',
        activatedAt: timestamp,
        expiresAt: null,
        lastUsedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    pagination: { ...emptyPagination, total: 1 },
  },
  agents: {
    items: [
      {
        id: 'agent-1',
        name: 'Build Agent',
        userId: 'user-1',
        hostId: 'host-1',
        status: 'active',
        mode: 'delegated',
        publicKey: 'public-key',
        kid: null,
        jwksUrl: null,
        lastUsedAt: null,
        activatedAt: timestamp,
        expiresAt: null,
        metadata: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    pagination: { ...emptyPagination, total: 1 },
  },
  capabilityGrants: {
    items: [
      {
        id: 'grant-1',
        agentId: 'agent-1',
        capability: 'account.profile.read',
        deniedBy: null,
        grantedBy: 'user-1',
        expiresAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: 'active',
        reason: null,
        constraints: null,
      },
    ],
    pagination: { ...emptyPagination, total: 1 },
  },
  approvalRequests: {
    items: [
      {
        id: 'approval-1',
        method: 'device_code',
        agentId: 'agent-1',
        hostId: 'host-1',
        userId: 'user-1',
        capabilities: 'account.profile.read',
        status: 'approved',
        loginHint: null,
        bindingMessage: null,
        clientNotificationEndpoint: null,
        deliveryMode: null,
        interval: 5,
        lastPolledAt: null,
        expiresAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    pagination: { ...emptyPagination, total: 1 },
  },
}
