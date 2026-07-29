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
  it(`renders AgentAuth inventory and stable identity governance
      [spec: admin-console/admin-agent-inventory]
      [spec: agent-identity/agent-governance-surfaces]`, async () => {
    const requests: Array<{ url: string; method: string }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = input instanceof Request ? input : null
      const url = request?.url ? new URL(request.url).pathname : String(input)
      const method = request?.method ?? init?.method ?? 'GET'
      requests.push({ url, method })

      if (url === '/api/management/agents/protocol-inventory') {
        return Promise.resolve(jsonResponse(agentInventory))
      }
      if (url === '/api/management/agents/identity-inventory') {
        return Promise.resolve(jsonResponse(identityInventory))
      }
      if (url === '/api/management/agent-audit-events') {
        return Promise.resolve(jsonResponse(agentAudit))
      }
      const allowedDeleteUrls = [
        '/api/management/agents/agent-1',
        '/api/management/agent-hosts/host-1',
        '/api/management/agent-capability-grants/grant-1',
        '/api/management/agent-identities/identity-1',
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
    expect(screen.getByText('Stable Build Agent')).toBeTruthy()
    expect(screen.getByText('Retired Personal Agent')).toBeTruthy()
    expect(screen.getByText('User user-2')).toBeTruthy()
    expect(screen.getByText('external_account.egress')).toBeTruthy()
    expect(screen.getByText('agent.token.denied')).toBeTruthy()

    for (const button of screen.getAllByRole('button', { name: 'Revoke' })) {
      fireEvent.click(button)
    }
    const retire = screen.getAllByRole('button', { name: 'Retire' }).find((button) => !button.hasAttribute('disabled'))
    expect(retire).toBeTruthy()
    fireEvent.click(retire!)

    await waitFor(() => {
      expect(requests).toContainEqual({ url: '/api/management/agent-capability-grants/grant-1', method: 'DELETE' })
      expect(requests).toContainEqual({ url: '/api/management/agents/agent-1', method: 'DELETE' })
      expect(requests).toContainEqual({ url: '/api/management/agent-hosts/host-1', method: 'DELETE' })
      expect(requests).toContainEqual({ url: '/api/management/agent-identities/identity-1', method: 'DELETE' })
    })
  })

  it('renders empty agent, host, and approval tables', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, _init) => {
      const request = input instanceof Request ? input : null
      const url = request?.url ? new URL(request.url).pathname : String(input)
      if (url === '/api/management/agents/protocol-inventory') {
        return Promise.resolve(jsonResponse(emptyInventory))
      }
      if (url === '/api/management/agents/identity-inventory') {
        return Promise.resolve(jsonResponse({ identities: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/agent-audit-events') {
        return Promise.resolve(jsonResponse({ events: [], pagination: emptyPagination }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(<AgentsPage />)

    expect(await screen.findByText('No delegated agents.')).toBeTruthy()
    expect(screen.getByText('No agent hosts.')).toBeTruthy()
    expect(screen.getByText('No approval requests.')).toBeTruthy()
    expect(screen.getByText('No stable Agent identities.')).toBeTruthy()
    expect(screen.getByText('No Agent audit events.')).toBeTruthy()
  })

  it('renders unlinked agents, hosts, and approvals with missing fields', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, _init) => {
      const request = input instanceof Request ? input : null
      const url = request?.url ? new URL(request.url).pathname : String(input)
      if (url === '/api/management/agents/protocol-inventory') {
        return Promise.resolve(jsonResponse(unlinkedInventory))
      }
      if (url === '/api/management/agents/identity-inventory') {
        return Promise.resolve(jsonResponse({ identities: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/agent-audit-events') {
        return Promise.resolve(jsonResponse({ events: [], pagination: emptyPagination }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(<AgentsPage />)

    expect(await screen.findByText('Floating Agent')).toBeTruthy()
    // unlinked user labels appear for agent, host, and approval rows
    expect(screen.getAllByText('Unlinked').length).toBeGreaterThanOrEqual(3)
    // host without a name falls back to its id, capabilities show "None"
    expect(screen.getAllByText('host-2').length).toBeGreaterThan(0)
    expect(screen.getAllByText('None').length).toBeGreaterThanOrEqual(1)
    // agent with no grants
    expect(screen.getByText('No grants')).toBeTruthy()
    // pending (non-active / non-approved) badges use the outline variant path
    expect(screen.getAllByText('pending').length).toBeGreaterThanOrEqual(3)
  })
})

const timestamp = '2026-01-01T00:00:00.000Z'

const identityInventory = {
  identities: [
    {
      id: 'identity-1',
      issuer: 'https://auth.example.com',
      subject: 'agt_stable',
      name: 'Stable Build Agent',
      homeSpace: { type: 'organization', organizationId: 'org-1' },
      status: 'active',
      retiredAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      bindings: [
        {
          id: 'binding-1',
          protocolAgentId: 'agent-1',
          hostId: 'host-1',
          status: 'active',
          boundAt: timestamp,
          revokedAt: null,
        },
      ],
    },
    {
      id: 'identity-2',
      issuer: 'https://auth.example.com',
      subject: 'agt_retired',
      name: 'Retired Personal Agent',
      homeSpace: { type: 'personal', userId: 'user-2' },
      status: 'retired',
      retiredAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      bindings: [
        {
          id: 'binding-2',
          protocolAgentId: 'agent-2',
          hostId: 'host-2',
          status: 'revoked',
          boundAt: timestamp,
          revokedAt: timestamp,
        },
      ],
    },
  ],
  pagination: { ...emptyPagination, total: 1 },
}

const agentAudit = {
  events: [
    {
      id: 'audit-1',
      action: 'external_account.egress',
      result: 'allowed',
      controllerUserId: 'user-1',
      subjectIssuer: 'https://auth.example.com',
      subject: 'agt_stable',
      agentIdentityId: 'identity-1',
      hostId: 'host-1',
      authorityGrantId: 'authority-1',
      externalAccountId: 'account-1',
      externalAccountGrantId: 'external-grant-1',
      targetOrigin: 'https://api.example.com',
      targetPath: '/v1/builds',
      method: 'GET',
      reasonCode: null,
      metadata: { upstreamStatus: 200 },
      occurredAt: timestamp,
    },
    {
      id: 'audit-2',
      action: 'agent.token.denied',
      result: 'denied',
      controllerUserId: null,
      subjectIssuer: null,
      subject: null,
      agentIdentityId: null,
      hostId: null,
      authorityGrantId: null,
      externalAccountId: null,
      externalAccountGrantId: null,
      targetOrigin: null,
      targetPath: null,
      method: null,
      reasonCode: 'forbidden',
      metadata: null,
      occurredAt: timestamp,
    },
  ],
  pagination: { ...emptyPagination, total: 1 },
}

const emptyInventory = {
  hosts: { items: [], pagination: { ...emptyPagination } },
  agents: { items: [], pagination: { ...emptyPagination } },
  capabilityGrants: { items: [], pagination: { ...emptyPagination } },
  approvalRequests: { items: [], pagination: { ...emptyPagination } },
}

const unlinkedInventory = {
  hosts: {
    items: [
      {
        id: 'host-2',
        name: null,
        userId: null,
        defaultCapabilities: null,
        publicKey: null,
        kid: null,
        jwksUrl: null,
        enrollmentTokenExpiresAt: null,
        status: 'pending',
        activatedAt: null,
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
        id: 'agent-2',
        name: 'Floating Agent',
        userId: null,
        hostId: null,
        status: 'pending',
        mode: 'delegated',
        publicKey: 'public-key',
        kid: null,
        jwksUrl: null,
        lastUsedAt: null,
        activatedAt: null,
        expiresAt: null,
        metadata: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    pagination: { ...emptyPagination, total: 1 },
  },
  capabilityGrants: { items: [], pagination: { ...emptyPagination } },
  approvalRequests: {
    items: [
      {
        id: 'approval-2',
        method: 'device_code',
        agentId: null,
        hostId: null,
        userId: null,
        capabilities: null,
        status: 'pending',
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
