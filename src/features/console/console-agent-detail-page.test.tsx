import type { ManagementAgent } from '@shared/api/agent-api'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentDetailPage } from '@/features/agents/management-agent-detail'
import { emptyPagination, jsonResponse, renderWithQuery } from './console.test-utils'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('console Agent detail', () => {
  it('reviews every Agent resource, deactivates it, and soft-deletes it', async () => {
    const requests: Array<{ method: string; path: string }> = []
    const scopeQueries: string[] = []
    const auditQueries: string[] = []
    let finishRevocation: ((response: Response) => void) | undefined
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      requests.push({ method: request.method, path: request.url.pathname })
      if (request.method === 'GET' && request.url.pathname === '/api/agents/agent-1/permissions') {
        scopeQueries.push(request.url.search)
      }
      if (request.method === 'GET' && request.url.pathname === '/api/realm/audit-events') {
        auditQueries.push(request.url.search)
      }
      if (request.method === 'DELETE' && request.url.pathname === '/api/agents/agent-1/activation') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (request.method === 'DELETE' && request.url.pathname === '/api/agents/agent-1') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (request.method === 'DELETE' && request.url.pathname === '/api/agents/agent-1/permissions/grant-until') {
        return new Promise<Response>((resolve) => {
          finishRevocation = resolve
        })
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

    expect(screen.queryByRole('tab', { name: 'Access requests' })).toBeNull()
    expect(requests.some((request) => request.path === '/api/access/requests')).toBe(false)

    openTab('Permissions')
    expect(await screen.findByRole('heading', { name: 'Projects API' })).toBeTruthy()
    const resourceNavigation = screen.getByRole('navigation', { name: 'Resource Servers' })
    expect(within(resourceNavigation).getByText('projects')).toBeTruthy()
    const resourceSearch = screen.getByRole('textbox', { name: 'Search Resource Servers' })
    fireEvent.change(resourceSearch, { target: { value: 'invoices' } })
    expect(within(resourceNavigation).queryByText('Projects API')).toBeNull()
    expect(within(resourceNavigation).getByText('Invoices API')).toBeTruthy()
    expect(await screen.findByText('One use')).toBeTruthy()
    expect(screen.getByText('Until revoked')).toBeTruthy()
    expect(screen.getByText(/^Until \d/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(3)
    fireEvent.click(within(resourceNavigation).getByText('Invoices API'))
    expect(await screen.findByRole('heading', { name: 'Invoices API' })).toBeTruthy()
    expect(await screen.findByText('invoices:read')).toBeTruthy()
    expect(screen.queryByText('projects:read')).toBeNull()
    await waitFor(() =>
      expect(scopeQueries.some((query) => new URLSearchParams(query).get('resourceServerId') === 'resource-2')).toBe(
        true,
      ),
    )
    fireEvent.change(resourceSearch, { target: { value: 'projects' } })
    fireEvent.click(within(resourceNavigation).getByText('Projects API'))
    expect(await screen.findByText('projects:read')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Revoke scope' }))
    expect(await screen.findByRole('button', { name: 'Revoking…' })).toBeTruthy()
    finishRevocation!(new Response(null, { status: 204 }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'DELETE',
        path: '/api/agents/agent-1/permissions/grant-until',
      }),
    )

    openTab('Activity')
    const activityTable = screen.getByRole('table')
    for (const label of [
      'Agent enrolled',
      'Agent recovered',
      'Agent deleted',
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
      expect(await within(activityTable).findByText(label)).toBeTruthy()
    }
    expect(screen.getAllByText('Realmroot').length).toBeGreaterThan(0)
    expect(screen.getAllByText('resource-missing')).toHaveLength(2)
    expect(screen.getByText('Scopes: projects:read')).toBeTruthy()
    expect(screen.getByText('Host host-1')).toBeTruthy()
    expect(screen.getByText('Reason: policy_denied')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search audit activity' }), {
      target: { value: 'projects:read' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by result' }), { target: { value: 'denied' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by event' }), {
      target: { value: 'api_resource.access_decided' },
    })
    await waitFor(() =>
      expect(
        auditQueries.some((query) => {
          const params = new URLSearchParams(query)
          return (
            params.get('search') === 'projects:read' &&
            params.get('result') === 'denied' &&
            params.get('action') === 'api_resource.access_decided'
          )
        }),
      ).toBe(true),
    )

    openTab('Settings')
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(requests).toContainEqual({ method: 'DELETE', path: '/api/agents/agent-1/activation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Agent' }))
    await waitFor(() => expect(requests).toContainEqual({ method: 'DELETE', path: '/api/agents/agent-1' }))
  })

  it('rejects cross-owner routes and shows empty Agent collections', async () => {
    let organizationOwned = false
    const requests: Array<{ method: string; path: string }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      requests.push({ method: request.method, path: request.url.pathname })
      if (request.method === 'PUT' && request.url.pathname === '/api/agents/agent-1/activation') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (request.method === 'DELETE' && request.url.pathname === '/api/agents/agent-1') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
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
            status: 'inactive',
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
    expect(screen.getByText('Inactive')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(requests).toContainEqual({ method: 'PUT', path: '/api/agents/agent-1/activation' }))

    const emptyTabs: Array<[string, string]> = [
      ['Installations', 'No installations'],
      ['Permissions', 'No Resource access'],
      ['Activity', 'No Agent activity'],
    ]
    for (const [tab, emptyTitle] of emptyTabs) {
      openTab(tab)
      expect(await screen.findByText(emptyTitle)).toBeTruthy()
    }
    openTab('Settings')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Agent' }))
    await waitFor(() => expect(requests).toContainEqual({ method: 'DELETE', path: '/api/agents/agent-1' }))
    scoped.unmount()

    renderWithQuery(<AgentDetailPage agentId="agent-1" section="settings" />)
    expect(await screen.findByText('Inactive')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Activate' })).toBeTruthy()
  })

  it('recovers from load failures, reports missing identities, and keeps failed deletion open', async () => {
    let failLoad = true
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (failLoad && request.url.pathname === '/api/agents/agent-1') {
        return Promise.resolve(jsonResponse({ message: 'Agent inventory unavailable.' }, 500))
      }
      if (request.method === 'DELETE' && request.url.pathname === '/api/agents/agent-1') {
        return Promise.resolve(jsonResponse({ message: 'Deletion unavailable.' }, 500))
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
      if (request.method === 'DELETE' && request.url.pathname === '/api/agents/agent-1') {
        return Promise.resolve(jsonResponse({ message: 'Deletion unavailable.' }, 500))
      }
      return Promise.resolve(agentDetailResponse(request.url, populatedCollections))
    })
    renderWithQuery(<AgentDetailPage agentId="agent-1" section="settings" />)
    expect(await screen.findByText('Delete Agent')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Agent' }))
    expect(await screen.findByText('Deletion unavailable.')).toBeTruthy()
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
  if (path === '/api/agents/agent-1/authorized-resource-servers') {
    const resources = new Map<string, { id: string; name: string; identifier: string; permissionCount: number }>()
    for (const permission of collections.grants.filter((item) => item.status === 'active')) {
      const existing = resources.get(permission.resource.id)
      resources.set(permission.resource.id, {
        ...permission.resource,
        permissionCount: (existing?.permissionCount ?? 0) + 1,
      })
    }
    return jsonResponse({ items: [...resources.values()], pagination: page(resources.size) })
  }
  if (path === '/api/agents/agent-1/permissions') {
    const resourceId = url.searchParams.get('resourceServerId')
    const activePermissions = collections.grants.filter((permission) => permission.status === 'active')
    const grants = resourceId
      ? activePermissions.filter((permission) => permission.resource.id === resourceId)
      : activePermissions
    return jsonResponse({ items: grants, pagination: page(grants.length) })
  }
  if (path === '/api/realm/audit-events') {
    const agentId = url.searchParams.get('agentId')
    const events = agentId
      ? collections.events.filter((event) => event.agentIdentityId === agentId)
      : collections.events
    return jsonResponse({ items: events, pagination: page(events.length) })
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
  installationCount: 2,
  pendingRequestCount: 1,
  activeResourceCount: 1,
  activeScopeCount: 3,
  createdAt: timestamp,
  updatedAt: timestamp,
}

function resource(id = 'resource-1') {
  if (id === 'resource-1') return { id, identifier: 'projects', name: 'Projects API' }
  if (id === 'resource-2') return { id, identifier: 'invoices', name: 'Invoices API' }
  return { id, identifier: id, name: id }
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
    accessRequestId: action.startsWith('api_resource.access_') ? 'request-1' : null,
    scopes: null,
    reasonCode: null,
    metadata: null,
    occurredAt: timestamp,
    resource: resourceId ? resource(resourceId) : null,
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
  grants: [
    {
      id: 'grant-until',
      agentId: 'agent-1',
      resource: resource(),
      scope: 'projects:read',
      mode: 'until',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: timestamp,
      sourceAccessRequestId: 'request-approved',
    },
    {
      id: 'grant-once',
      agentId: 'agent-1',
      resource: resource(),
      scope: 'projects:write',
      mode: 'once',
      status: 'active',
      expiresAt: null,
      createdAt: timestamp,
    },
    {
      id: 'grant-persistent',
      agentId: 'agent-1',
      resource: resource(),
      scope: 'projects:admin',
      mode: 'persistent',
      status: 'active',
      expiresAt: null,
      createdAt: timestamp,
    },
    {
      id: 'grant-invoices',
      agentId: 'agent-1',
      resource: resource('resource-2'),
      scope: 'invoices:read',
      mode: 'persistent',
      status: 'active',
      expiresAt: null,
      createdAt: timestamp,
      sourceAccessRequestId: 'request-approved',
    },
  ],
  events: [
    auditEvent('event-1', 'agent.identity_enrolled', 'allowed', null),
    auditEvent('event-2', 'agent.identity_recovered', 'allowed', 'resource-1'),
    auditEvent('event-3', 'agent.identity_deleted', 'allowed', 'resource-missing'),
    auditEvent('event-4', 'agent.host_revoked', 'denied', null),
    auditEvent('event-5', 'agent.capability_decided', 'denied', null),
    auditEvent('event-6', 'agent.capability_decided', 'allowed', null),
    auditEvent('event-7', 'api_resource.access_requested', 'pending', 'resource-1'),
    {
      ...auditEvent('event-8', 'api_resource.access_decided', 'denied', 'resource-1'),
      scopes: ['projects:read'],
      hostId: 'host-1',
      reasonCode: 'policy_denied',
    },
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
  grants: [],
  events: [],
} as typeof populatedCollections

function page(total: number) {
  return { ...emptyPagination, total }
}
