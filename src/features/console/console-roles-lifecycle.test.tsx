import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsoleScopeProvider } from '@/lib/console-context'
import {
  apiResource,
  application,
  emptyPagination,
  jsonResponse,
  organization,
  renderWithQuery,
  role,
  user,
} from './console.test-utils'
import { RoleDetailPage, RolesPage } from './extracted/roles'

Element.prototype.scrollIntoView ??= () => {}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('console Role lifecycle', () => {
  it('reviews permission and assignment variants and assigns a Role to a workload', async () => {
    let permissions = [
      { resourceId: 'resource-1', scope: 'projects:read' },
      { resourceId: 'resource-missing', scope: 'legacy:read' },
    ]
    const mutations: Array<{ method: string; path: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestDetails(input, init)
      if (request.method === 'PUT' && request.url.pathname === '/api/access/roles/role-1/scopes') {
        const body = await readBody(request.request, init?.body)
        permissions = (body as { scopes: typeof permissions }).scopes
        mutations.push({ method: request.method, path: request.url.pathname, body })
        return rolePermissions(permissions)
      }
      if (request.method === 'POST' && request.url.pathname === '/api/access/assignments') {
        const body = await readBody(request.request, init?.body)
        mutations.push({ method: request.method, path: request.url.pathname, body })
        return jsonResponse({ id: 'assignment-new' }, 201)
      }
      return roleResponse(request.url, permissions)
    })

    renderWithQuery(<RoleDetailPage roleId="role-1" />)
    expect(await screen.findByRole('heading', { name: 'Build operator' })).toBeTruthy()
    expect(screen.getByText('Reusable Realm-wide permission definition.')).toBeTruthy()
    const permissionSummary = screen
      .getAllByText('Permissions')
      .find((element) => element.closest('.detailFlatRow'))
      ?.closest('.detailFlatRow')
    expect(permissionSummary?.textContent).toContain('2')

    openTab('Permissions')
    expect(await screen.findByText('projects:read')).toBeTruthy()
    expect(screen.getByText('legacy:read')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search permissions'), { target: { value: 'legacy' } })
    expect(screen.queryByText('projects:read')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search permissions'), { target: { value: 'missing' } })
    expect(await screen.findByText('No permissions found')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search permissions'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filter resource server'), { target: { value: 'resource-1' } })
    expect(screen.getByText('projects:read')).toBeTruthy()
    expect(screen.queryByText('legacy:read')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Edit permissions' }))
    expect(await screen.findByText('projects:write')).toBeTruthy()
    expect(screen.getByText('No description provided by this Resource server.')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Select projects:read'))
    fireEvent.click(screen.getByLabelText('Select projects:write'))
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }))
    await waitFor(() =>
      expect(mutations).toContainEqual({
        method: 'PUT',
        path: '/api/access/roles/role-1/scopes',
        body: {
          scopes: [
            { resourceId: 'resource-1', scope: 'projects:write' },
            { resourceId: 'resource-missing', scope: 'legacy:read' },
          ],
        },
      }),
    )

    openTab('Assignments')
    expect((await screen.findAllByText('Jane Doe')).length).toBeGreaterThan(0)
    expect(screen.getByText('Build Agent')).toBeTruthy()
    expect(screen.getByText('Customer portal')).toBeTruthy()
    expect(screen.getAllByText('unknown-subject').length).toBeGreaterThan(0)
    expect(screen.getByText('Realm-wide')).toBeTruthy()
    expect(screen.getByText('Unknown Organization')).toBeTruthy()
    expect(screen.getAllByText('System').length).toBeGreaterThan(0)
    expect(screen.getByText('Expired')).toBeTruthy()
    expect(screen.getByText('Revoked')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Assign role' }))
    fireEvent.change(screen.getByLabelText('Subject type'), { target: { value: 'agent' } })
    fireEvent.click(screen.getByLabelText('Subject'))
    fireEvent.click(await screen.findByRole('option', { name: 'Build Agent' }))
    fireEvent.change(screen.getByLabelText('Subject type'), { target: { value: 'application' } })
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'app-1' } })
    fireEvent.change(screen.getByLabelText('Context'), { target: { value: 'org-1' } })
    fireEvent.change(screen.getByLabelText('Expires'), { target: { value: 'date' } })
    fireEvent.change(screen.getByLabelText('Expiry date and time'), { target: { value: '2099-01-01T12:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign role' }))
    await waitFor(() =>
      expect(mutations).toContainEqual({
        method: 'POST',
        path: '/api/access/assignments',
        body: {
          roleId: 'role-1',
          subjectId: 'app-1',
          subjectType: 'workload',
          organizationId: 'org-1',
          expiresAt: new Date('2099-01-01T12:30').toISOString(),
        },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Assign role' }))
    fireEvent.change(screen.getByLabelText('Subject type'), { target: { value: 'agent' } })
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'agent-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('renders system Roles in Organization context with empty assignment inventories', async () => {
    let listMode = false
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (request.url.pathname === '/api/access/roles') {
        return Promise.resolve(
          jsonResponse({
            roles: [{ ...role, description: 'Realm administrator.', system: true }],
            pagination: page(1),
          }),
        )
      }
      if (request.url.pathname === '/api/access/roles/role-1') {
        return Promise.resolve(jsonResponse({ ...role, description: 'Realm administrator.', system: true }))
      }
      if (request.url.pathname === '/api/access/roles/role-1/scopes') {
        return Promise.resolve(listMode ? jsonResponse(null) : rolePermissions([]))
      }
      if (request.url.pathname === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [], pagination: page(0) }))
      }
      if (request.url.pathname === '/api/access/assignments') {
        return Promise.resolve(jsonResponse({ assignments: [], pagination: page(0) }))
      }
      if (
        request.url.pathname === '/api/users' ||
        request.url.pathname === '/api/applications' ||
        request.url.pathname === '/api/agents' ||
        request.url.pathname === '/api/organizations'
      ) {
        return Promise.resolve(jsonResponse({ message: 'Inventory unavailable.' }, 500))
      }
      throw new Error(`Unexpected system Role request: ${request.method} ${request.url}`)
    })

    const detail = renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: 'org-1', realmOperator: false }}>
        <RoleDetailPage roleId="role-1" />
      </ConsoleScopeProvider>,
    )
    expect(await screen.findByText('Realm administrator.')).toBeTruthy()
    expect(screen.getAllByText('System').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Roles' }).getAttribute('href')).toContain('context=org-1')

    openTab('Permissions')
    expect(await screen.findByText('No permissions found')).toBeTruthy()
    expect(screen.getByText('Use Edit permissions to add scopes from any Resource server.')).toBeTruthy()

    openTab('Assignments')
    expect(await screen.findByText('No role assignments')).toBeTruthy()

    openTab('Settings')
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveProperty('disabled', true)
    expect(screen.getByText('System roles cannot be deleted')).toBeTruthy()

    detail.unmount()
    listMode = true
    renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: 'org-1', realmOperator: false }}>
        <RolesPage />
      </ConsoleScopeProvider>,
    )
    expect(await screen.findByRole('link', { name: 'Admin' })).toBeTruthy()
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).toContain('context=org-1')
    }
  })

  it('reports permission concurrency metadata and retryable assignment failures', async () => {
    let assignmentFailure = false
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (request.url.pathname === '/api/access/roles/role-1/scopes') {
        return Promise.resolve(
          assignmentFailure
            ? rolePermissions([{ resourceId: 'resource-1', scope: 'projects:read' }])
            : jsonResponse({ roleId: 'role-1', scopes: [{ resourceId: 'resource-1', scope: 'projects:read' }] }),
        )
      }
      if (assignmentFailure && request.url.pathname === '/api/access/assignments') {
        return Promise.resolve(jsonResponse({ message: 'Assignments unavailable.' }, 500))
      }
      return Promise.resolve(roleResponse(request.url, [{ resourceId: 'resource-1', scope: 'projects:read' }]))
    })

    const permissions = renderWithQuery(<RoleDetailPage roleId="role-1" section="permissions" />)
    expect(await screen.findByText('Role permissions response did not include an ETag.')).toBeTruthy()
    permissions.unmount()

    assignmentFailure = true
    renderWithQuery(<RoleDetailPage roleId="role-1" section="assignments" />)
    expect(await screen.findByText('Assignments unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  })

  it('keeps failed Role editors and assignments open and reports deletion failures', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (request.method !== 'GET') return Promise.resolve(jsonResponse({ message: 'Role change failed.' }, 500))
      return Promise.resolve(roleResponse(request.url, [{ resourceId: 'resource-1', scope: 'projects:read' }]))
    })
    renderWithQuery(<RoleDetailPage roleId="role-1" section="settings" />)
    expect(await screen.findByRole('heading', { name: 'Build operator' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Role change failed.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete role' }))
    expect(await screen.findByText('Role change failed.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    openTab('Permissions')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit permissions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Role change failed.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    openTab('Assignments')
    fireEvent.click(await screen.findByRole('button', { name: 'Assign role' }))
    fireEvent.click(await screen.findByLabelText('Subject'))
    fireEvent.click(await screen.findByRole('option', { name: 'Jane Doe' }))
    fireEvent.click(screen.getByRole('button', { name: 'Assign role' }))
    expect(await screen.findByText('Role change failed.')).toBeTruthy()
  })

  it('renders retryable and missing Role detail states plus filtered Role inventory', async () => {
    let fail = true
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (fail && request.url.pathname === '/api/access/roles/role-1') {
        return Promise.resolve(jsonResponse({ message: 'Role unavailable.' }, 500))
      }
      return Promise.resolve(roleResponse(request.url, []))
    })
    const failed = renderWithQuery(<RoleDetailPage roleId="role-1" />)
    expect(await screen.findByText('Role unavailable.')).toBeTruthy()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Build operator' })).toBeTruthy()
    failed.unmount()

    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (request.url.pathname === '/api/access/roles/role-1') return Promise.resolve(jsonResponse(null))
      return Promise.resolve(roleResponse(request.url, []))
    })
    const missing = renderWithQuery(<RoleDetailPage roleId="role-1" />)
    expect(await screen.findByText('Role not found.')).toBeTruthy()
    missing.unmount()

    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (request.url.pathname === '/api/access/roles') {
        return Promise.resolve(
          jsonResponse({ roles: [customRole, { ...role, id: 'role-system' }], pagination: page(2) }),
        )
      }
      if (request.url.pathname.endsWith('/scopes')) {
        return Promise.resolve(jsonResponse({ message: 'Permissions unavailable.' }, 500))
      }
      throw new Error(`Unexpected Role list request: ${request.method} ${request.url}`)
    })
    renderWithQuery(<RolesPage />)
    expect(await screen.findByText('Build operator')).toBeTruthy()
    const dataPanel = screen.getByRole('table').closest('.consoleDataTablePanel')
    expect(screen.getByLabelText('Search roles').closest('.consoleDataTablePanel')).toBe(dataPanel)
    expect((await screen.findAllByText('Unavailable')).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Filter role type'), { target: { value: 'system' } })
    expect(screen.getByText('Admin')).toBeTruthy()
    expect(screen.queryByText('Build operator')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search roles'), { target: { value: 'missing' } })
    expect(await screen.findByText('No roles found')).toBeTruthy()
  })
})

function openTab(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false })
}

function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null
  return {
    method: request?.method ?? init?.method ?? 'GET',
    request,
    url: new URL(request?.url ?? String(input), window.location.origin),
  }
}

async function readBody(request: Request | null, body?: BodyInit | null) {
  return request ? request.clone().json() : body ? JSON.parse(String(body)) : undefined
}

function roleResponse(url: URL, permissions: Array<{ resourceId: string; scope: string }>) {
  if (url.pathname === '/api/access/roles/role-1') return jsonResponse(customRole)
  if (url.pathname === '/api/access/roles/role-1/scopes') return rolePermissions(permissions)
  if (url.pathname === '/api/resource-servers') {
    return jsonResponse({ items: [apiResource, secondResource], pagination: page(2) })
  }
  if (url.pathname === '/api/resource-servers/resource-1/contract') return jsonResponse(projectContract)
  if (url.pathname === '/api/resource-servers/resource-2/contract') return jsonResponse(billingContract)
  if (url.pathname === '/api/access/assignments') {
    return jsonResponse({ assignments, pagination: page(assignments.length) })
  }
  if (url.pathname === '/api/users') return jsonResponse({ users: [user], pagination: page(1) })
  if (url.pathname === '/api/applications') return jsonResponse({ applications: [application], pagination: page(1) })
  if (url.pathname === '/api/agents') return jsonResponse({ items: [agent], pagination: page(1) })
  if (url.pathname === '/api/organizations') {
    return jsonResponse({ organizations: [organization, unknownOrganization], pagination: page(2) })
  }
  throw new Error(`Unexpected Role request: ${url}`)
}

function rolePermissions(permissions: Array<{ resourceId: string; scope: string }>) {
  return jsonResponse({ roleId: 'role-1', scopes: permissions }, 200, { etag: '"permissions-v1"' })
}

const timestamp = '2026-01-01T00:00:00.000Z'
const customRole = { ...role, name: 'Build operator', key: 'build.operator', description: null, system: false }
const secondResource = { ...apiResource, id: 'resource-2', identifier: 'billing', name: 'Billing API' }
const projectContract = {
  resourceId: 'resource-1',
  sourceUrl: 'https://api.example.com/openapi.json',
  scopes: [
    { value: 'projects:read', description: 'Read projects' },
    { value: 'projects:write', description: null },
  ],
  operations: [],
}
const billingContract = {
  resourceId: 'resource-2',
  sourceUrl: 'https://billing.example.com/openapi.json',
  scopes: [{ value: 'billing:read', description: 'Read billing' }],
  operations: [],
}
const agent = {
  id: 'agent-1',
  issuer: 'https://identity.example.com',
  subject: 'agt_build',
  name: 'Build Agent',
  homeSpace: { type: 'organization', organizationId: 'org-1' },
  owner: { id: 'org-1', type: 'organization', displayName: 'Acme Inc.' },
  status: 'active',
  retiredAt: null,
  installationCount: 1,
  roleCount: 1,
  pendingRequestCount: 0,
  activeGrantCount: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
}
const unknownOrganization = {
  ...organization,
  id: 'org-known-as-unknown',
  name: 'Unknown Organization',
  displayName: null,
}
const assignments = [
  {
    id: 'assignment-user',
    roleId: 'role-1',
    subjectType: 'user',
    subjectId: 'user-1',
    organizationId: null,
    assignedByUserId: 'user-1',
    expiresAt: null,
    revokedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'assignment-agent',
    roleId: 'role-1',
    subjectType: 'agent',
    subjectId: 'agent-1',
    organizationId: 'org-1',
    assignedByUserId: 'user-missing',
    expiresAt: '2099-01-01T00:00:00.000Z',
    revokedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'assignment-workload',
    roleId: 'role-1',
    subjectType: 'workload',
    subjectId: 'app-1',
    organizationId: 'org-known-as-unknown',
    assignedByUserId: null,
    expiresAt: '2020-01-01T00:00:00.000Z',
    revokedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'assignment-unknown',
    roleId: 'role-1',
    subjectType: 'user',
    subjectId: 'unknown-subject',
    organizationId: 'org-missing',
    assignedByUserId: 'user-missing',
    expiresAt: null,
    revokedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
]

function page(total: number) {
  return { ...emptyPagination, total }
}
