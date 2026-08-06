import type { ManagementAgent } from '@shared/api/agent-api'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentDetailPage } from '@/features/agents/management-agent-detail'
import { emptyPagination, jsonResponse, renderWithQuery } from './console.test-utils'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('console Agent detail', () => {
  it('reviews every Agent resource and retires an active identity', async () => {
    const requests: Array<{ method: string; path: string }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      requests.push({ method: request.method, path: request.url.pathname })
      if (request.method === 'PUT' && request.url.pathname === '/api/agents/agent-1/retirement') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(agentDetailResponse(request.url, populatedCollections))
    })

    renderWithQuery(<AgentDetailPage agentId="agent-1" />)

    expect(await screen.findByRole('heading', { name: 'Build Agent' })).toBeTruthy()
    expect(screen.getByText('Organization')).toBeTruthy()
    expect(screen.getByText('Acme Engineering · org-1')).toBeTruthy()

    openTab('Installations')
    expect(await screen.findByText('Remote host')).toBeTruthy()
    expect(screen.getByText('Remote JWKS')).toBeTruthy()
    expect(screen.getByText('Public key')).toBeTruthy()
    expect(screen.getByText('Never')).toBeTruthy()

    openTab('Access requests')
    expect(await screen.findByText('request-pending')).toBeTruthy()
    expect(screen.getByText('request-approved')).toBeTruthy()

    openTab('Access grants')
    expect(await screen.findByText('One use')).toBeTruthy()
    expect(screen.getByText('Until revoked')).toBeTruthy()
    expect(screen.getByText(/^Until \d/)).toBeTruthy()

    openTab('Activity')
    for (const label of [
      'Agent enrolled',
      'Agent recovered',
      'Agent retired',
      'Host revoked',
      'Agent permissions denied',
      'Agent permissions approved',
      'Resource access requested',
      'Resource access denied',
      'Resource access approved',
      'Resource access revoked',
      'Access token issued',
      'custom.action',
    ]) {
      expect(await screen.findByText(label)).toBeTruthy()
    }
    expect(screen.getAllByText('Realmroot').length).toBeGreaterThan(0)
    expect(screen.getByText('resource-missing')).toBeTruthy()

    openTab('Settings')
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retire Agent' }))
    await waitFor(() => expect(requests).toContainEqual({ method: 'PUT', path: '/api/agents/agent-1/retirement' }))
  })

  it('rejects cross-owner routes and shows empty Agent collections', async () => {
    let organizationOwned = false
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      return Promise.resolve(
        agentDetailResponse(request.url, {
          ...emptyCollections,
          agent: {
            ...agent,
            homeSpace: organizationOwned
              ? { type: 'organization', organizationId: 'org-1' }
              : { type: 'personal', userId: 'user-1' },
            owner: organizationOwned
              ? { id: 'org-1', type: 'organization', displayName: 'Acme Engineering' }
              : { id: 'user-1', type: 'user', displayName: 'Jane Doe' },
            status: 'retired',
          },
        }),
      )
    })

    const mismatched = renderWithQuery(<AgentDetailPage agentId="agent-1" organizationId="org-1" section="settings" />)
    expect(await screen.findByText('Agent does not belong to this Organization.')).toBeTruthy()
    mismatched.unmount()

    organizationOwned = true
    const scoped = renderWithQuery(<AgentDetailPage agentId="agent-1" organizationId="org-1" section="settings" />)
    expect(await screen.findByRole('heading', { name: 'Build Agent' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByText('Already retired')).toBeTruthy()

    const emptyTabs: Array<[string, string]> = [
      ['Installations', 'No installations'],
      ['Access requests', 'No access requests'],
      ['Access grants', 'No active access grants'],
      ['Activity', 'No Agent activity'],
    ]
    for (const [tab, emptyTitle] of emptyTabs) {
      openTab(tab)
      expect(await screen.findByText(emptyTitle)).toBeTruthy()
    }
    scoped.unmount()

    renderWithQuery(<AgentDetailPage agentId="agent-1" section="settings" />)
    expect(await screen.findByText('Already retired')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retire' })).toHaveProperty('disabled', true)
  })

  it('recovers from load failures, reports missing identities, and keeps failed retirement open', async () => {
    let failLoad = true
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (failLoad && request.url.pathname === '/api/agents/agent-1') {
        return Promise.resolve(jsonResponse({ message: 'Agent inventory unavailable.' }, 500))
      }
      if (request.method === 'PUT' && request.url.pathname.endsWith('/retirement')) {
        return Promise.resolve(jsonResponse({ message: 'Retirement unavailable.' }, 500))
      }
      return Promise.resolve(agentDetailResponse(request.url, populatedCollections))
    })

    const failed = renderWithQuery(<AgentDetailPage agentId="agent-1" />)
    expect(await screen.findByText('Agent inventory unavailable.')).toBeTruthy()
    failLoad = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Build Agent' })).toBeTruthy()
    failed.unmount()

    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (request.url.pathname === '/api/agents/agent-1') return Promise.resolve(jsonResponse({}))
      return Promise.resolve(agentDetailResponse(request.url, emptyCollections))
    })
    const missing = renderWithQuery(<AgentDetailPage agentId="agent-1" />)
    expect(await screen.findByText('Agent not found.')).toBeTruthy()
    missing.unmount()

    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (request.method === 'PUT' && request.url.pathname.endsWith('/retirement')) {
        return Promise.resolve(jsonResponse({ message: 'Retirement unavailable.' }, 500))
      }
      return Promise.resolve(agentDetailResponse(request.url, populatedCollections))
    })
    renderWithQuery(<AgentDetailPage agentId="agent-1" section="settings" />)
    expect(await screen.findByText('Retire Agent')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retire Agent' }))
    expect(await screen.findByText('Retirement unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  })
})

function openTab(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false })
}

function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null
  return {
    method: request?.method ?? init?.method ?? 'GET',
    url: new URL(request?.url ?? String(input), window.location.origin),
  }
}

type AgentCollections = typeof populatedCollections

function agentDetailResponse(url: URL, collections: AgentCollections) {
  const path = url.pathname
  if (path === '/api/agents/agent-1') return jsonResponse({ agent: collections.agent })
  if (path === '/api/agents/agent-1/installations') {
    return jsonResponse({ items: collections.installations, pagination: page(collections.installations.length) })
  }
  if (path === '/api/access/requests') {
    return jsonResponse({ items: collections.requests, pagination: page(collections.requests.length) })
  }
  if (path === '/api/access/authorizations') {
    return jsonResponse({ items: collections.grants, pagination: page(collections.grants.length) })
  }
  if (path === '/api/realm/audit-events') {
    return jsonResponse({ items: collections.events, pagination: page(collections.events.length) })
  }
  throw new Error(`Unexpected Agent detail request: ${url}`)
}

const timestamp = '2026-01-01T00:00:00.000Z'
const agent: ManagementAgent = {
  id: 'agent-1',
  issuer: 'https://identity.acme.dev',
  subject: 'agt_build',
  name: 'Build Agent',
  homeSpace: { type: 'organization', organizationId: 'org-1' },
  owner: { id: 'org-1', type: 'organization', displayName: 'Acme Engineering' },
  status: 'active',
  retiredAt: null,
  installationCount: 2,
  roleCount: 1,
  pendingRequestCount: 1,
  activeGrantCount: 3,
  createdAt: timestamp,
  updatedAt: timestamp,
}

function resource(id = 'resource-1') {
  return { id, identifier: id === 'resource-1' ? 'projects' : id, name: id === 'resource-1' ? 'Projects API' : id }
}

function auditEvent(id: string, action: string, result: 'allowed' | 'denied' | 'pending', resourceId: string | null) {
  return {
    id,
    action,
    result,
    controllerUserId: 'user-1',
    subjectIssuer: agent.issuer,
    subject: agent.subject,
    agentIdentityId: 'agent-1',
    hostId: null,
    resourceId,
    resourceConnectionId: null,
    accessGrantId: null,
    scopes: null,
    reasonCode: null,
    metadata: null,
    occurredAt: timestamp,
  }
}

const populatedCollections = {
  agent,
  installations: [
    {
      id: 'host-1',
      name: 'Remote host',
      status: 'active',
      credentialType: 'remote_jwks',
      boundAt: timestamp,
      lastSeenAt: timestamp,
    },
    {
      id: 'host-2',
      name: 'Local host',
      status: 'revoked',
      credentialType: 'public_key',
      boundAt: timestamp,
      lastSeenAt: null,
    },
  ],
  requests: [
    {
      id: 'request-pending',
      agentId: 'agent-1',
      resource: resource(),
      scopes: ['projects:read'],
      reason: null,
      status: 'pending',
      expiresAt: timestamp,
      decidedAt: null,
      createdAt: timestamp,
    },
    {
      id: 'request-approved',
      agentId: 'agent-1',
      resource: resource(),
      scopes: ['projects:write'],
      reason: 'Deploy',
      status: 'approved',
      expiresAt: timestamp,
      decidedAt: timestamp,
      createdAt: timestamp,
    },
  ],
  grants: [
    {
      id: 'grant-until',
      agentId: 'agent-1',
      resource: resource(),
      scopes: ['projects:read'],
      mode: 'until',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: timestamp,
    },
    {
      id: 'grant-once',
      agentId: 'agent-1',
      resource: resource(),
      scopes: ['projects:write'],
      mode: 'once',
      status: 'consumed',
      expiresAt: null,
      createdAt: timestamp,
    },
    {
      id: 'grant-persistent',
      agentId: 'agent-1',
      resource: resource(),
      scopes: ['projects:admin'],
      mode: 'persistent',
      status: 'active',
      expiresAt: null,
      createdAt: timestamp,
    },
  ],
  events: [
    auditEvent('event-1', 'agent.identity_enrolled', 'allowed', null),
    auditEvent('event-2', 'agent.identity_recovered', 'allowed', 'resource-1'),
    auditEvent('event-3', 'agent.identity_retired', 'allowed', 'resource-missing'),
    auditEvent('event-4', 'agent.host_revoked', 'denied', null),
    auditEvent('event-5', 'agent.capability_decided', 'denied', null),
    auditEvent('event-6', 'agent.capability_decided', 'allowed', null),
    auditEvent('event-7', 'api_resource.access_requested', 'pending', 'resource-1'),
    auditEvent('event-8', 'api_resource.access_decided', 'denied', 'resource-1'),
    auditEvent('event-9', 'api_resource.access_decided', 'allowed', 'resource-1'),
    auditEvent('event-10', 'api_resource.access_revoked', 'allowed', 'resource-1'),
    auditEvent('event-11', 'api_resource.token_issued', 'allowed', 'resource-1'),
    auditEvent('event-12', 'custom.action', 'allowed', null),
    { ...auditEvent('event-other', 'agent.identity_enrolled', 'allowed', null), agentIdentityId: 'agent-other' },
  ],
}

const emptyCollections = {
  agent,
  installations: [],
  requests: [],
  grants: [],
  events: [],
} as typeof populatedCollections

function page(total: number) {
  return { ...emptyPagination, total }
}
