import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyPagination, jsonResponse, renderWithQuery } from './console.test-utils'
import { OrganizationDetailPage, OrganizationsPage } from './extracted/organizations'

Element.prototype.scrollIntoView ??= () => {}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('console Organization lifecycle', () => {
  it('manages members, invitations, Agents, activity, profile, and lifecycle', async () => {
    const mutations: Array<{ method: string; path: string; body?: unknown }> = []
    let currentOrganization = { ...organization }
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestDetails(input, init)
      if (request.method !== 'GET') {
        const body = request.request
          ? await request.request
              .clone()
              .json()
              .catch(() => undefined)
          : parseBody(init?.body)
        mutations.push({ method: request.method, path: request.url.pathname, body })
        if (request.method === 'PATCH' && request.url.pathname === '/api/organizations/org-1') {
          currentOrganization = { ...currentOrganization, ...(body as object) }
          return jsonResponse(currentOrganization)
        }
        if (request.method === 'PUT' && request.url.pathname.includes('/members/')) {
          return jsonResponse(body)
        }
        if (request.method === 'POST' && request.url.pathname.endsWith('/invitations')) {
          return jsonResponse({ ...invitations[0], ...(body as object) }, 201)
        }
        if (request.method === 'DELETE') return new Response(null, { status: 204 })
      }
      return organizationResponse(request.url, currentOrganization)
    })

    renderWithQuery(<OrganizationDetailPage organizationId="org-1" />)
    expect(await screen.findByRole('heading', { name: 'Acme Engineering' })).toBeTruthy()
    expect(screen.getByText('Pending invitations').closest('.detailFlatRow')?.textContent).toContain('1')

    openTab('Members')
    expect(screen.getAllByText('user-missing').length).toBeGreaterThan(0)
    expect(screen.getByText('custom')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search members'), { target: { value: 'missing' } })
    expect(screen.queryByText('Alex Admin')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search members'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filter access level'), { target: { value: 'admin' } })
    expect(screen.getByText('Alex Admin')).toBeTruthy()
    expect(screen.queryByText('Dana Developer')).toBeNull()
    fireEvent.click(screen.getByLabelText('Filter access level'))
    fireEvent.click(await screen.findByRole('option', { name: 'Any access level' }))

    openMemberMenu('Alex Admin')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove Administrator' }))
    await waitFor(() =>
      expect(mutations).toContainEqual({
        method: 'PUT',
        path: '/api/organizations/org-1/members/member-admin/roles',
        body: { roles: ['member'] },
      }),
    )

    openMemberMenu('Dana Developer')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Administrator' }))
    await waitFor(() =>
      expect(mutations).toContainEqual({
        method: 'PUT',
        path: '/api/organizations/org-1/members/member-developer/roles',
        body: { roles: ['admin', 'developer'] },
      }),
    )

    openMemberMenu('Dana Developer')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove member' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove member' }))
    await waitFor(() =>
      expect(mutations).toContainEqual({
        method: 'DELETE',
        path: '/api/organizations/org-1/members/member-developer',
        body: undefined,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel invitation for invited@example.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invitation' }))
    await waitFor(() =>
      expect(mutations).toContainEqual({
        method: 'DELETE',
        path: '/api/organizations/org-1/invitations/invitation-1',
        body: undefined,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Invite member' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByLabelText('Member'))
    fireEvent.click(screen.getByLabelText('Developer'))
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
    await waitFor(() =>
      expect(mutations).toContainEqual({
        method: 'POST',
        path: '/api/organizations/org-1/invitations',
        body: { email: 'new@example.com', roles: ['developer'] },
      }),
    )

    openTab('Agents')
    expect(await screen.findByText('Organization Agent')).toBeTruthy()
    expect(screen.getByText('Retired Organization Agent')).toBeTruthy()
    expect(screen.queryByText('Other Agent')).toBeNull()
    openTab('Activity')
    expect(await screen.findByText('agent.identity_enrolled')).toBeTruthy()
    expect(screen.getByText('Realmroot')).toBeTruthy()
    expect(screen.queryByText('event-other')).toBeNull()

    openTab('Settings')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme Updated' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'acme-updated' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('heading', { name: 'Acme Updated' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }))
    fireEvent.click(screen.getByRole('button', { name: 'Suspend organization' }))
    expect((await screen.findAllByText('Suspended')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resume organization' }))
    await waitFor(() => expect(screen.getAllByText('Active').length).toBeGreaterThan(0))
  })

  it('keeps failed Organization mutation surfaces open with actionable errors', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (request.method !== 'GET')
        return Promise.resolve(jsonResponse({ message: 'Organization change failed.' }, 500))
      return Promise.resolve(organizationResponse(request.url, { ...organization, disabled: true }))
    })
    renderWithQuery(<OrganizationDetailPage organizationId="org-1" section="settings" />)
    expect(await screen.findByRole('heading', { name: 'Acme Engineering' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Organization change failed.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resume organization' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Organization change failed.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete organization' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Organization change failed.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    openTab('Members')
    fireEvent.click(screen.getByRole('button', { name: 'Invite member' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'failure@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Organization change failed.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    openMemberMenu('Dana Developer')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove member' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove member' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Organization change failed.')
  })

  it('renders empty Organization resources, missing records, and retryable load failures', async () => {
    let fail = true
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (fail && request.url.pathname === '/api/organizations/org-1') {
        return Promise.resolve(jsonResponse({ message: 'Organization unavailable.' }, 500))
      }
      return Promise.resolve(organizationResponse(request.url, organization, true))
    })
    const failed = renderWithQuery(<OrganizationDetailPage organizationId="org-1" />)
    expect(await screen.findByText('Organization unavailable.')).toBeTruthy()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Acme Engineering' })).toBeTruthy()
    openTab('Members')
    expect(await screen.findByText('No members found')).toBeTruthy()
    openTab('Agents')
    expect(await screen.findByText('No Agent identities')).toBeTruthy()
    openTab('Activity')
    expect(await screen.findByText('No recent activity')).toBeTruthy()
    failed.unmount()

    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (request.url.pathname === '/api/organizations/org-1') return Promise.resolve(jsonResponse(null))
      return Promise.resolve(organizationResponse(request.url, organization, true))
    })
    renderWithQuery(<OrganizationDetailPage organizationId="org-1" />)
    expect(await screen.findByText('Organization not found.')).toBeTruthy()
  })

  it('shows unavailable member counts without hiding the Organization inventory', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (request.url.pathname === '/api/organizations') {
        return Promise.resolve(
          jsonResponse({
            organizations: [
              organization,
              { ...organization, id: 'org-2', name: 'Northwind', displayName: null },
              { ...organization, id: 'org_platform' },
            ],
            pagination: page(3),
          }),
        )
      }
      if (request.url.pathname === '/api/agents')
        return Promise.resolve(jsonResponse({ items: agents, pagination: page(agents.length) }))
      if (request.url.pathname.endsWith('/members')) return Promise.resolve(jsonResponse({ message: 'offline' }, 500))
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })
    renderWithQuery(<OrganizationsPage />)
    expect(await screen.findByText('Acme Engineering')).toBeTruthy()
    expect(screen.getByText('Northwind')).toBeTruthy()
    expect(await screen.findByText('Unavailable')).toBeTruthy()
    expect(screen.queryByText('org_platform')).toBeNull()
  })
})

function openTab(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false })
}

function openMemberMenu(name: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name: `Manage ${name}` }), { button: 0, ctrlKey: false })
}

function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null
  return {
    method: request?.method ?? init?.method ?? 'GET',
    request,
    url: new URL(request?.url ?? String(input), window.location.origin),
  }
}

function parseBody(body: BodyInit | null | undefined) {
  return body ? JSON.parse(String(body)) : undefined
}

function organizationResponse(url: URL, currentOrganization: typeof organization, empty = false) {
  if (url.pathname === '/api/organizations/org-1') return jsonResponse(currentOrganization)
  if (url.pathname === '/api/organizations/org-1/members') {
    return jsonResponse({ members: empty ? [] : members, pagination: page(empty ? 0 : members.length) })
  }
  if (url.pathname === '/api/organizations/org-1/invitations') {
    return jsonResponse({ invitations: empty ? [] : invitations, pagination: page(empty ? 0 : invitations.length) })
  }
  if (url.pathname === '/api/organizations/org-1/roles') {
    return jsonResponse({ roles: organizationRoles, pagination: page(organizationRoles.length) })
  }
  if (url.pathname === '/api/users')
    return jsonResponse({ users: empty ? [] : users, pagination: page(empty ? 0 : users.length) })
  if (url.pathname === '/api/agents')
    return jsonResponse({ items: empty ? [] : agents, pagination: page(empty ? 0 : agents.length) })
  if (url.pathname === '/api/realm/audit-events')
    return jsonResponse({ items: empty ? [] : events, pagination: page(empty ? 0 : events.length) })
  throw new Error(`Unexpected Organization request: ${url}`)
}

const timestamp = '2026-01-01T00:00:00.000Z'
const organizationRoles = ['owner', 'admin', 'developer', 'member'].map((key) => ({
  key,
  displayName: key[0]!.toUpperCase() + key.slice(1),
  description: null,
  predefined: true,
  scopes: [],
  createdAt: timestamp,
  updatedAt: timestamp,
}))
const organization = {
  id: 'org-1',
  name: 'Acme Engineering',
  displayName: 'Acme Engineering',
  slug: 'acme',
  logo: null,
  metadata: null,
  disabled: false,
  disabledReason: null,
  createdAt: timestamp,
  updatedAt: timestamp,
}
const users = [
  {
    id: 'user-owner',
    email: 'owner@example.com',
    name: 'Owner User',
    displayName: 'Owner User',
    role: 'user',
    banned: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'user-admin',
    email: 'admin@example.com',
    name: 'Alex Admin',
    displayName: 'Alex Admin',
    role: 'user',
    banned: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'user-developer',
    email: 'developer@example.com',
    name: 'Dana Developer',
    displayName: 'Dana Developer',
    role: 'user',
    banned: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'user-name',
    email: null,
    name: 'Name Only',
    displayName: null,
    role: 'user',
    banned: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
]
const members = [
  { id: 'member-owner', organizationId: 'org-1', userId: 'user-owner', roles: ['owner'], createdAt: timestamp },
  { id: 'member-admin', organizationId: 'org-1', userId: 'user-admin', roles: ['admin'], createdAt: timestamp },
  {
    id: 'member-developer',
    organizationId: 'org-1',
    userId: 'user-developer',
    roles: ['developer'],
    createdAt: timestamp,
  },
  { id: 'member-name', organizationId: 'org-1', userId: 'user-name', roles: ['member'], createdAt: timestamp },
  { id: 'member-missing', organizationId: 'org-1', userId: 'user-missing', roles: ['custom'], createdAt: timestamp },
]
const invitations = [
  {
    id: 'invitation-1',
    organizationId: 'org-1',
    email: 'invited@example.com',
    roles: ['member'],
    inviterId: 'user-owner',
    status: 'pending',
    expiresAt: '2099-01-01T00:00:00.000Z',
    acceptedAt: null,
    revokedAt: null,
    createdAt: timestamp,
  },
  {
    id: 'invitation-old',
    organizationId: 'org-1',
    email: 'old@example.com',
    roles: ['member'],
    inviterId: 'user-owner',
    status: 'accepted',
    expiresAt: timestamp,
    acceptedAt: timestamp,
    revokedAt: null,
    createdAt: timestamp,
  },
]
const agents = [
  {
    id: 'agent-org',
    issuer: 'https://identity.example.com',
    subject: 'agt_org',
    name: 'Organization Agent',
    homeSpace: { type: 'organization', organizationId: 'org-1' },
    owner: { id: 'org-1', type: 'organization', displayName: 'Acme Engineering' },
    status: 'active',
    retiredAt: null,
    installationCount: 1,
    roleCount: 0,
    pendingRequestCount: 0,
    activeGrantCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'agent-other',
    issuer: 'https://identity.example.com',
    subject: 'agt_other',
    name: 'Other Agent',
    homeSpace: { type: 'organization', organizationId: 'org-2' },
    owner: { id: 'org-2', type: 'organization', displayName: 'Other' },
    status: 'retired',
    retiredAt: timestamp,
    installationCount: 0,
    roleCount: 0,
    pendingRequestCount: 0,
    activeGrantCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'agent-org-retired',
    issuer: 'https://identity.example.com',
    subject: 'agt_org_retired',
    name: 'Retired Organization Agent',
    homeSpace: { type: 'organization', organizationId: 'org-1' },
    owner: { id: 'org-1', type: 'organization', displayName: 'Acme Engineering' },
    status: 'retired',
    retiredAt: timestamp,
    installationCount: 0,
    roleCount: 0,
    pendingRequestCount: 0,
    activeGrantCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
]
const events = [
  {
    id: 'event-org',
    action: 'agent.identity_enrolled',
    result: 'allowed',
    controllerUserId: 'user-owner',
    subjectIssuer: null,
    subject: null,
    agentIdentityId: 'agent-org',
    hostId: null,
    resourceId: null,
    resourceConnectionId: null,
    accessGrantId: null,
    scopes: null,
    reasonCode: null,
    metadata: null,
    occurredAt: timestamp,
  },
  {
    id: 'event-other',
    action: 'agent.identity_retired',
    result: 'denied',
    controllerUserId: 'user-owner',
    subjectIssuer: null,
    subject: null,
    agentIdentityId: 'agent-other',
    hostId: null,
    resourceId: 'resource-1',
    resourceConnectionId: null,
    accessGrantId: null,
    scopes: null,
    reasonCode: null,
    metadata: null,
    occurredAt: timestamp,
  },
  {
    id: 'event-denied',
    action: 'api_resource.access_decided',
    result: 'denied',
    controllerUserId: 'user-owner',
    subjectIssuer: null,
    subject: null,
    agentIdentityId: 'agent-org',
    hostId: null,
    resourceId: 'resource-1',
    resourceConnectionId: null,
    accessGrantId: null,
    scopes: null,
    reasonCode: null,
    metadata: null,
    occurredAt: timestamp,
  },
]

function page(total: number) {
  return { ...emptyPagination, total }
}
