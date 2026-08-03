import type { ApiResource } from '@shared/api/agent-api'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiResourceDetailPage, ApiResourcesPage } from '@/features/console/extracted/api-resources'
import { RoleDetailPage } from '@/features/console/extracted/roles'
import { RoleAssignmentsPage } from '@/features/console/pages/role-assignments-page'
import { ConsoleScopeProvider } from '@/lib/console-context'
import {
  apiResource,
  application,
  emptyPagination,
  jsonResponse,
  organization,
  pagination,
  renderWithQuery,
  role,
  user,
} from './console.test-utils'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...original, useNavigate: () => navigate }
})

globalThis.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}
Element.prototype.scrollIntoView ??= () => {}

afterEach(() => {
  cleanup()
  navigate.mockClear()
  vi.restoreAllMocks()
})

function requestParts(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null
  const rawUrl = String(input)
  return {
    url: request?.url
      ? new URL(request.url).pathname
      : rawUrl.startsWith('http')
        ? new URL(rawUrl).pathname
        : rawUrl.split('?')[0],
    method: request?.method ?? init?.method ?? 'GET',
    body: request?.body ? request.json() : init?.body ? Promise.resolve(JSON.parse(String(init.body))) : null,
  }
}

const genericConnector = {
  id: 'connector-1',
  providerId: 'projects',
  providerType: 'generic_oauth',
  slug: 'projects',
  displayName: 'Projects OIDC',
  enabled: true,
  loginEnabled: false,
  clientId: 'realmroot',
  clientSecretConfigured: true,
  issuer: 'https://projects.example.com',
  authorizationEndpoint: 'https://projects.example.com/authorize',
  tokenEndpoint: 'https://projects.example.com/token',
  userInfoEndpoint: null,
  jwksEndpoint: 'https://projects.example.com/jwks',
  registrationEndpoint: null,
  revocationEndpoint: null,
  registrationMode: 'manual',
  scopes: ['openid'],
  providerMetadata: {},
  createdAt: apiResource.createdAt,
  updatedAt: apiResource.updatedAt,
}

const contract = {
  resourceId: 'resource-1',
  sourceUrl: 'https://auth.example.com/openapi.json',
  scopes: [
    { value: 'projects:read', description: 'Read projects' },
    { value: 'projects:write', description: 'Change projects' },
  ],
  operations: [
    {
      method: 'GET',
      path: '/projects',
      operationId: 'listProjects',
      summary: 'List projects',
      description: 'Returns visible projects.',
      requiredScopeSets: [['projects:read']],
    },
  ],
}

function rolePermissionsResponse(permissions: Array<{ resourceId: string; scope: string }>) {
  return jsonResponse({ roleId: 'role-1', permissions }, 200, { etag: '"permissions-v1"' })
}

describe('console API resources and roles', () => {
  it('shows Roles that use a native Resource server and their active assignment counts', async () => {
    let permissionAttempts = 0
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/api-resources/resource-1') return jsonResponse(apiResource)
      if (request.url === '/api/organizations') {
        return jsonResponse({ organizations: [organization], pagination })
      }
      if (request.url === '/api/connectors') {
        return jsonResponse({ connectors: [], pagination: emptyPagination })
      }
      if (request.url === '/api/roles') return jsonResponse({ roles: [role], pagination })
      if (request.url === '/api/roles/role-1/permissions') {
        permissionAttempts += 1
        if (permissionAttempts === 1) return jsonResponse({ error: 'permissions unavailable' }, 503)
        return rolePermissionsResponse([{ resourceId: apiResource.id, scope: 'projects:read' }])
      }
      if (request.url === '/api/role-assignments') {
        return jsonResponse({ assignments: [], pagination: { ...pagination, total: 2 } })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: organization.id, realmOperator: true }}>
        <ApiResourceDetailPage resourceId="resource-1" section="authority" />
      </ConsoleScopeProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    const row = (await screen.findByRole('link', { name: role.name })).closest('tr') as HTMLElement
    expect(within(row).getByText('projects:read')).toBeTruthy()
    expect(within(row).getByText('2')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Active assignments' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull()
  })

  it('filters and revokes assignments from the Realm-wide role inventory', async () => {
    let revokedAt: string | null = null
    const requests: Array<{ url: string; method: string }> = []
    const creations: unknown[] = []
    const agent = {
      id: 'agent-1',
      issuer: 'https://identity.example.com',
      subject: 'agt_build',
      name: 'Build Agent',
      homeSpace: { type: 'organization', organizationId: organization.id },
      owner: { id: organization.id, type: 'organization', displayName: organization.displayName },
      status: 'active',
      retiredAt: null,
      installationCount: 1,
      roleCount: 1,
      pendingRequestCount: 0,
      activeGrantCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/role-assignments' && request.method === 'GET') {
        return jsonResponse({
          assignments: [
            {
              id: 'assignment-1',
              roleId: role.id,
              subjectType: 'user',
              subjectId: user.id,
              organizationId: organization.id,
              expiresAt: null,
              revokedAt,
              assignedByUserId: user.id,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'assignment-expired',
              roleId: role.id,
              subjectType: 'workload',
              subjectId: application.id,
              organizationId: null,
              expiresAt: '2020-01-01T00:00:00.000Z',
              revokedAt: null,
              assignedByUserId: null,
              createdAt: '2020-01-01T00:00:00.000Z',
              updatedAt: '2020-01-01T00:00:00.000Z',
            },
            {
              id: 'assignment-revoked',
              roleId: 'role-missing',
              subjectType: 'agent',
              subjectId: agent.id,
              organizationId: 'org-missing',
              expiresAt: null,
              revokedAt: '2026-01-01T00:00:00.000Z',
              assignedByUserId: 'user-missing',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'assignment-unknown-subject',
              roleId: role.id,
              subjectType: 'user',
              subjectId: 'user-unknown',
              organizationId: null,
              expiresAt: null,
              revokedAt: '2026-01-01T00:00:00.000Z',
              assignedByUserId: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          pagination,
        })
      }
      if (request.url === '/api/role-assignments' && request.method === 'POST') {
        const body = await request.body
        creations.push(body)
        return jsonResponse(
          {
            id: 'assignment-created',
            ...(body as object),
            assignedByUserId: user.id,
            revokedAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          201,
        )
      }
      if (request.url === '/api/role-assignments/assignment-1/revocation' && request.method === 'PUT') {
        requests.push({ url: request.url, method: request.method })
        revokedAt = '2026-01-02T00:00:00.000Z'
        return jsonResponse({ roleAssignmentId: 'assignment-1', revokedAt })
      }
      if (request.url === '/api/roles') return jsonResponse({ roles: [role], pagination })
      if (request.url === '/api/users') return jsonResponse({ users: [user], pagination })
      if (request.url === '/api/applications') return jsonResponse({ applications: [application], pagination })
      if (request.url === '/api/agents') return jsonResponse({ items: [agent], pagination })
      if (request.url === '/api/organizations') {
        return jsonResponse({
          organizations: [organization, { ...organization, id: 'org-2', displayName: null, name: 'Plain Org' }],
          pagination,
        })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<RoleAssignmentsPage />)
    expect((await screen.findAllByText('Jane Doe')).length).toBeGreaterThan(0)
    expect(screen.getByText('Customer portal')).toBeTruthy()
    expect(screen.getByText('Build Agent')).toBeTruthy()
    expect(screen.getAllByText('Expired').some((element) => element.tagName === 'SPAN')).toBe(true)
    expect(screen.getAllByText('System')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Assign role' }))
    let assignmentDialog = screen.getByRole('dialog', { name: 'Assign role' })
    fireEvent.change(within(assignmentDialog).getByLabelText('Subject type'), { target: { value: 'agent' } })
    expect(within(assignmentDialog).getByRole('option', { name: 'Build Agent' })).toBeTruthy()
    fireEvent.change(within(assignmentDialog).getByLabelText('Subject type'), { target: { value: 'application' } })
    fireEvent.change(within(assignmentDialog).getByLabelText('Subject'), { target: { value: application.id } })
    fireEvent.change(within(assignmentDialog).getByLabelText('Role'), { target: { value: role.id } })
    fireEvent.change(within(assignmentDialog).getByLabelText('Context'), { target: { value: organization.id } })
    fireEvent.change(within(assignmentDialog).getByLabelText('Expires'), { target: { value: 'date' } })
    fireEvent.change(within(assignmentDialog).getByLabelText('Expiry date and time'), {
      target: { value: '2030-01-02T03:04' },
    })
    fireEvent.click(within(assignmentDialog).getByRole('button', { name: 'Assign role' }))
    await waitFor(() =>
      expect(creations).toEqual([
        {
          roleId: role.id,
          subjectId: application.id,
          expiresAt: new Date('2030-01-02T03:04').toISOString(),
          subjectType: 'workload',
          organizationId: organization.id,
        },
      ]),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Assign role' }))
    assignmentDialog = screen.getByRole('dialog', { name: 'Assign role' })
    expect(within(assignmentDialog).getByLabelText('Expires')).toHaveProperty('value', 'never')
    expect(within(assignmentDialog).queryByLabelText('Expiry date and time')).toBeNull()
    fireEvent.click(within(assignmentDialog).getByRole('button', { name: 'Cancel' }))
    fireEvent.change(screen.getByLabelText('Search role assignments'), { target: { value: 'absent-value' } })
    expect(screen.getByRole('heading', { name: 'No matching role assignments' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search role assignments'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filter assignment subject type'), { target: { value: 'workload' } })
    expect(screen.getByText('Customer portal')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter assignment subject type'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filter assignments by role'), { target: { value: role.id } })
    fireEvent.change(screen.getByLabelText('Filter assignments by context'), { target: { value: 'realm' } })
    expect(screen.getByText('Customer portal')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter assignments by context'), { target: { value: organization.id } })
    fireEvent.change(screen.getByLabelText('Filter assignment status'), { target: { value: 'active' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Revoke role assignment' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke assignment' }))

    await waitFor(() =>
      expect(requests).toEqual([{ url: '/api/role-assignments/assignment-1/revocation', method: 'PUT' }]),
    )
    fireEvent.change(screen.getByLabelText('Filter assignment status'), { target: { value: 'revoked' } })
    await waitFor(() => expect(screen.getAllByText('Revoked').some((element) => element.tagName === 'SPAN')).toBe(true))
  })

  it('renders and filters the unified Resource server inventory', async () => {
    const external = {
      ...apiResource,
      id: 'resource-external',
      name: 'Projects API',
      resourceUrl: 'https://projects.example.com/api',
      connectorId: 'connector-1',
      enabled: false,
    }
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const { url } = requestParts(input)
      if (url === '/api/api-resources') {
        return Promise.resolve(jsonResponse({ items: [apiResource, external], pagination }))
      }
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [genericConnector], pagination }))
      }
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: organization.id, realmOperator: true }}>
        <ApiResourcesPage />
      </ConsoleScopeProvider>,
    )

    expect(await screen.findByText('Projects API')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Authorization' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Protected resource' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Owner' })).toBeTruthy()
    expect(screen.getAllByText('External').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Filter authorization'), { target: { value: 'native' } })
    expect(screen.queryByText('Projects API')).toBeNull()
    expect(screen.getByText('Management API')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search resource servers'), { target: { value: 'missing' } })
    expect(screen.getByText('No resource servers found')).toBeTruthy()
  })

  it('creates an externally authorized Resource server with explicit ownership and eligibility [spec: agent-identity/external-api-resource-registration]', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/api-resources' && request.method === 'POST') {
        requests.push({ ...request, body: await request.body })
        return jsonResponse({ ...apiResource, name: 'Projects API', connectorId: 'connector-1' }, 201)
      }
      if (request.url === '/api/api-resources') {
        return jsonResponse({ items: [], pagination: emptyPagination })
      }
      if (request.url === '/api/connectors') {
        return jsonResponse({ connectors: [genericConnector], pagination })
      }
      if (request.url === '/api/organizations') {
        return jsonResponse({ organizations: [organization], pagination })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<ApiResourcesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New resource server' }))
    expect(screen.getByRole('heading', { name: 'New resource server' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Projects API' } })
    fireEvent.change(screen.getByLabelText('Identifier'), { target: { value: 'projects' } })
    fireEvent.change(screen.getByLabelText('Protected resource URL'), {
      target: { value: 'https://projects.example.com/api' },
    })
    fireEvent.change(screen.getByLabelText('Authorization model'), { target: { value: 'connector-1' } })
    fireEvent.change(screen.getByLabelText('Authorization detail templates'), { target: { value: '{' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/JSON/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Authorization detail templates'), {
      target: {
        value: JSON.stringify([{ type: 'project_access', actions: ['read'], project_id: 'project-1' }]),
      },
    })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Projects' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          url: '/api/api-resources',
          method: 'POST',
          body: {
            name: 'Projects API',
            identifier: 'projects',
            resourceUrl: 'https://projects.example.com/api',
            connectorId: 'connector-1',
            authorizationDetails: [{ type: 'project_access', actions: ['read'], project_id: 'project-1' }],
            description: 'Projects',
            ownerOrganizationId: 'org-1',
            accessEligibility: { mode: 'realm', organizationIds: [] },
            availableToAgents: true,
          },
        },
      ]),
    )
  })

  it('filters lifecycle states and creates a Resource server for selected Organizations', async () => {
    const betaOrganization = {
      ...organization,
      id: 'org-2',
      slug: 'beta',
      name: 'Beta',
      displayName: 'Beta LLC',
    }
    const disabledResource = {
      ...apiResource,
      id: 'resource-disabled',
      name: 'Disabled API',
      enabled: false,
      ownerOrganizationId: betaOrganization.id,
    }
    const archivedResource = {
      ...apiResource,
      id: 'resource-archived',
      name: 'Archived API',
      archivedAt: '2026-07-30T19:00:00.000Z',
      ownerOrganizationId: betaOrganization.id,
    }
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/api-resources' && request.method === 'POST') {
        requests.push(await request.body)
        return jsonResponse({ ...apiResource, id: 'resource-created', name: 'Selected API' }, 201)
      }
      if (request.url === '/api/api-resources') {
        return jsonResponse({ items: [apiResource, disabledResource, archivedResource], pagination })
      }
      if (request.url === '/api/connectors') {
        return jsonResponse({ connectors: [genericConnector], pagination })
      }
      if (request.url === '/api/organizations') {
        return jsonResponse({ organizations: [organization, betaOrganization], pagination })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<ApiResourcesPage />)
    expect(await screen.findByText('Disabled API')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter status'), { target: { value: 'disabled' } })
    expect(screen.getByText('Disabled API')).toBeTruthy()
    expect(screen.queryByText('Archived API')).toBeNull()
    fireEvent.change(screen.getByLabelText('Filter status'), { target: { value: 'archived' } })
    expect(screen.getByText('Archived API')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter owner'), { target: { value: betaOrganization.id } })
    expect(await screen.findByText('Archived API')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'New resource server' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'New resource server' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Selected API' } })
    fireEvent.change(screen.getByLabelText('Identifier'), { target: { value: 'selected-api' } })
    fireEvent.change(screen.getByLabelText('Protected resource URL'), {
      target: { value: 'https://selected.example.com/api' },
    })
    fireEvent.change(screen.getByLabelText('Access eligibility'), { target: { value: 'organizations' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Select at least one Organization.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: betaOrganization.id } })
    fireEvent.click(screen.getByRole('combobox', { name: 'Eligible Organizations' }))
    const betaOption = (await screen.findAllByRole('option', { name: /Beta LLC/ })).find(
      (option) => option.tagName === 'DIV',
    )
    expect(betaOption).toBeTruthy()
    fireEvent.click(betaOption as HTMLElement)
    fireEvent.click(screen.getByRole('switch', { name: 'Available to Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          name: 'Selected API',
          identifier: 'selected-api',
          resourceUrl: 'https://selected.example.com/api',
          authorizationDetails: [],
          ownerOrganizationId: betaOrganization.id,
          accessEligibility: { mode: 'organizations', organizationIds: [betaOrganization.id] },
          availableToAgents: false,
        },
      ]),
    )
  })

  it('shows protected resources and their required scopes as a dedicated detail tab', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const { url } = requestParts(input)
      if (url === '/api/api-resources/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/api-resources/resource-1/contract') return Promise.resolve(jsonResponse(contract))
      if (url === '/api/connectors')
        return Promise.resolve(jsonResponse({ connectors: [], pagination: emptyPagination }))
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" section="resources" />)

    expect(await screen.findByRole('heading', { name: 'Management API' })).toBeTruthy()
    expect(screen.getByText('List projects')).toBeTruthy()
    expect(screen.getByText('/projects')).toBeTruthy()
    expect(screen.getByText('projects:read')).toBeTruthy()
    expect(screen.getByText('Returns visible projects.')).toBeTruthy()
    expect(screen.queryByText(contract.sourceUrl)).toBeNull()
  })

  it('recovers the protected-resource contract and renders every scope requirement shape', async () => {
    let contractAttempts = 0
    const complexContract = {
      ...contract,
      operations: [
        {
          method: 'GET',
          path: '/summary',
          operationId: 'getSummary',
          summary: 'Get summary',
          description: null,
          requiredScopeSets: [[], ['summary:read', 'summary:audit'], ['summary:admin']],
        },
        {
          method: 'POST',
          path: '/operation-id',
          operationId: 'createById',
          summary: null,
          description: 'Creates a record.',
          requiredScopeSets: [['records:write']],
        },
        {
          method: 'DELETE',
          path: '/fallback',
          operationId: null,
          summary: null,
          description: null,
          requiredScopeSets: [],
        },
      ],
    }
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const { url } = requestParts(input)
      if (url === '/api/api-resources/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/api-resources/resource-1/contract') {
        contractAttempts += 1
        return Promise.resolve(
          contractAttempts === 1 ? jsonResponse({ error: 'contract unavailable' }, 503) : jsonResponse(complexContract),
        )
      }
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination: emptyPagination }))
      }
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)
    expect(await screen.findByText('Native authorization · resource-1')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Resources' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Get summary')).toBeTruthy()
    expect(screen.getByText('getSummary')).toBeTruthy()
    expect(screen.getByText('createById')).toBeTruthy()
    expect(screen.getByText('Protected operation')).toBeTruthy()
    expect(screen.getByText('Authenticated')).toBeTruthy()
    expect(screen.getAllByText('or')).toHaveLength(2)
    expect(screen.getByText('+')).toBeTruthy()
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('edits Resource server ownership and actor eligibility from its settings section', async () => {
    const betaOrganization = {
      ...organization,
      id: 'org-2',
      slug: 'beta',
      name: 'Beta',
      displayName: 'Beta LLC',
    }
    const requests: unknown[] = []
    let selected: ApiResource = {
      ...apiResource,
      description: null,
      enabled: false,
      availableToAgents: false,
      accessEligibility: { mode: 'organizations', organizationIds: [betaOrganization.id] },
    }
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/api-resources/resource-1' && request.method === 'PATCH') {
        const body = await request.body
        requests.push(body)
        selected = { ...selected, ...(body as Partial<ApiResource>) }
        return jsonResponse(selected)
      }
      if (request.url === '/api/api-resources/resource-1') return jsonResponse(selected)
      if (request.url === '/api/connectors') {
        return jsonResponse({ connectors: [], pagination: emptyPagination })
      }
      if (request.url === '/api/organizations') {
        return jsonResponse({ organizations: [organization, betaOrganization], pagination })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)
    expect(await screen.findByText('Beta LLC')).toBeTruthy()
    expect(screen.getByText('No')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Settings' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('Not configured')).toBeTruthy()

    const access = screen.getByRole('heading', { name: 'Ownership & access' }).closest('section') as HTMLElement
    fireEvent.click(within(access).getByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByLabelText('Owner'), { target: { value: betaOrganization.id } })
    fireEvent.click(screen.getByRole('combobox', { name: 'Eligible Organizations' }))
    const acmeOption = (await screen.findAllByRole('option', { name: /Acme Inc\./ })).find(
      (option) => option.tagName === 'DIV',
    )
    expect(acmeOption).toBeTruthy()
    fireEvent.click(acmeOption as HTMLElement)
    fireEvent.click(screen.getByRole('switch', { name: 'Available to Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(requests).toContainEqual({
        ownerOrganizationId: betaOrganization.id,
        accessEligibility: { mode: 'organizations', organizationIds: [betaOrganization.id, organization.id] },
        availableToAgents: true,
      }),
    )
    fireEvent.click(within(access).getByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByLabelText('Eligible actors'), { target: { value: 'owner_organization' } })
    expect(screen.queryByRole('combobox', { name: 'Eligible Organizations' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
    await waitFor(() => expect(requests).toContainEqual({ enabled: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('shows incomplete external authorization without inventing provider state', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const { url } = requestParts(input)
      if (url === '/api/api-resources/resource-1') {
        return Promise.resolve(jsonResponse({ ...apiResource, connectorId: 'connector-1', authorization: null }))
      }
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination: emptyPagination }))
      }
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" section="authority" />)
    expect(await screen.findByText('External OIDC provider')).toBeTruthy()
    expect(screen.getAllByText('Not configured')).toHaveLength(3)
    const overviewTab = screen.getByRole('tab', { name: 'Overview' })
    fireEvent.mouseDown(overviewTab, { button: 0, ctrlKey: false })
    expect(await screen.findByText('Access eligibility')).toBeTruthy()
    expect(overviewTab.getAttribute('aria-selected')).toBe('true')
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Settings' }), { button: 0, ctrlKey: false })
    expect(await screen.findByRole('heading', { name: 'Authorization provider' })).toBeTruthy()
    expect(screen.getByText('connector-1')).toBeTruthy()
    expect(screen.getByText('Pending validation')).toBeTruthy()
  })

  it('uses section-level editors and preserves native/external authorization differences', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    let selected: ApiResource = apiResource
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/api-resources/resource-1' && request.method === 'PATCH') {
        const body = await request.body
        requests.push({ ...request, body })
        selected = { ...selected, ...(body as Partial<ApiResource>) }
        return jsonResponse(selected)
      }
      if (request.url === '/api/api-resources/resource-1') return jsonResponse(selected)
      if (request.url === '/api/connectors') {
        return jsonResponse({
          connectors: [genericConnector, { ...genericConnector, id: 'connector-2', displayName: 'Projects OIDC 2' }],
          pagination,
        })
      }
      if (request.url === '/api/organizations') {
        return jsonResponse({ organizations: [organization], pagination })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" section="settings" />)
    expect(await screen.findByText('Native authorization · resource-1')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Authorization provider' })).toBeNull()
    const details = screen.getByRole('heading', { name: 'Resource server details' }).closest('section') as HTMLElement
    fireEvent.click(within(details).getByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Updated API' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/api-resources/resource-1',
        method: 'PATCH',
        body: {
          name: 'Updated API',
          identifier: apiResource.identifier,
          resourceUrl: apiResource.resourceUrl,
          description: apiResource.description,
        },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/api-resources/resource-1',
        method: 'PATCH',
        body: { enabled: false },
      }),
    )

    cleanup()
    selected = {
      ...apiResource,
      connectorId: 'connector-1',
      authorizationDetails: [{ type: 'project_access', actions: ['read'], project_id: 'project-1' }],
      authorization: {
        connectorId: 'connector-1',
        resourceUrl: 'https://projects.example.com/api',
        issuer: 'https://projects.example.com',
        authorizationEndpoint: 'https://projects.example.com/authorize',
        tokenEndpoint: 'https://projects.example.com/token',
        pushedAuthorizationRequestEndpoint: null,
        authorizationDetailsTypesSupported: [],
        authorizationDetailsCatalogEndpoint: null,
        authorizationDetailsCatalogScope: null,
        registrationEndpoint: null,
        revocationEndpoint: 'https://projects.example.com/revoke',
        jwksUri: 'https://projects.example.com/jwks',
        userInfoEndpoint: null,
        registrationMode: 'manual',
        clientId: 'realmroot',
        clientSecretConfigured: true,
        status: 'active',
        createdAt: apiResource.createdAt,
        updatedAt: apiResource.updatedAt,
      },
    }
    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" section="settings" />)
    expect(await screen.findByText('External authorization · resource-1')).toBeTruthy()
    const provider = screen.getByRole('heading', { name: 'Authorization provider' }).closest('section') as HTMLElement
    fireEvent.click(within(provider).getByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByLabelText('OIDC connector'), { target: { value: 'connector-2' } })
    fireEvent.change(screen.getByLabelText('Authorization detail templates'), { target: { value: '{}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Authorization detail templates'), {
      target: {
        value: JSON.stringify([{ type: 'project_access', actions: ['read'], project_id: 'project-1' }]),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/api-resources/resource-1',
        method: 'PATCH',
        body: {
          connectorId: 'connector-2',
          authorizationDetails: [{ type: 'project_access', actions: ['read'], project_id: 'project-1' }],
        },
      }),
    )
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Authorization' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('https://projects.example.com')).toBeTruthy()
    expect(screen.getByText('active')).toBeTruthy()
    expect(screen.getByText('manual')).toBeTruthy()
  })

  it('[spec: admin-console/admin-archive-api-resource] archives and restores a Resource server as a disabled draft', async () => {
    const requests: Array<{ url: string; method: string }> = []
    let selected: ApiResource = apiResource
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/api-resources/resource-1/archival' && request.method === 'PUT') {
        requests.push({ url: request.url, method: request.method })
        selected = { ...selected, enabled: false, archivedAt: '2026-07-30T19:00:00.000Z' }
        return Promise.resolve(jsonResponse(selected))
      }
      if (request.url === '/api/api-resources/resource-1/archival' && request.method === 'DELETE') {
        requests.push({ url: request.url, method: request.method })
        selected = { ...selected, enabled: false, archivedAt: null }
        return Promise.resolve(jsonResponse(selected))
      }
      if (request.url === '/api/api-resources/resource-1') return Promise.resolve(jsonResponse(selected))
      if (request.url === '/api/connectors')
        return Promise.resolve(jsonResponse({ connectors: [], pagination: emptyPagination }))
      if (request.url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" section="settings" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/revokes active connections, grants, pending requests/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive resource server' }))

    expect(await screen.findByText('Archived')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restore resource server' }))
    expect((await screen.findAllByText('Disabled')).length).toBeGreaterThan(0)
    expect(requests).toEqual([
      { url: '/api/api-resources/resource-1/archival', method: 'PUT' },
      { url: '/api/api-resources/resource-1/archival', method: 'DELETE' },
    ])
  })

  it('edits global role permissions with search and Resource server filtering', async () => {
    const customRole = { ...role, system: false }
    let assigned = [{ resourceId: 'resource-1', scope: 'projects:read' }]
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/roles/role-1/permissions' && request.method === 'PUT') {
        const body = (await request.body) as { permissions: typeof assigned }
        requests.push({ ...request, body })
        assigned = body.permissions
        return rolePermissionsResponse(assigned)
      }
      if (request.url === '/api/roles/role-1/permissions') {
        return rolePermissionsResponse(assigned)
      }
      if (request.url === '/api/roles/role-1') return jsonResponse(customRole)
      if (request.url === '/api/api-resources/resource-1/contract') return jsonResponse(contract)
      if (request.url === '/api/api-resources') return jsonResponse({ items: [apiResource], pagination })
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<RoleDetailPage roleId="role-1" section="permissions" />)
    expect(await screen.findByText('projects:read')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit permissions' }))
    const search = await screen.findByLabelText('Search available permissions')
    fireEvent.change(search, { target: { value: 'missing' } })
    expect(screen.getByRole('heading', { name: 'No matching permissions' })).toBeTruthy()
    fireEvent.change(search, { target: { value: 'write' } })
    expect(screen.getByText('projects:write')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter available permissions by resource server'), {
      target: { value: 'resource-1' },
    })
    fireEvent.click(screen.getByLabelText('Select projects:write'))
    fireEvent.change(search, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }))

    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/roles/role-1/permissions',
        method: 'PUT',
        body: {
          permissions: [
            { resourceId: 'resource-1', scope: 'projects:read' },
            { resourceId: 'resource-1', scope: 'projects:write' },
          ],
        },
      }),
    )
  })

  it('keeps the Role key stable while editing human-readable metadata [spec: admin-console/admin-create-role]', async () => {
    const customRole = { ...role, system: false }
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    let deleted = false
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/roles/role-1' && request.method === 'DELETE') {
        deleted = true
        return new Response(null, { status: 204 })
      }
      if (deleted && request.url.startsWith('/api/roles/role-1')) {
        throw new Error(`Removed Role detail was refetched: ${request.method} ${request.url}`)
      }
      if (request.url === '/api/roles/role-1' && request.method === 'PATCH') {
        requests.push({ ...request, body: await request.body })
        return jsonResponse({ ...customRole, ...(requests[0]!.body as object) })
      }
      if (request.url === '/api/roles/role-1/permissions') {
        return rolePermissionsResponse([])
      }
      if (request.url === '/api/roles/role-1') return jsonResponse(customRole)
      if (request.url === '/api/api-resources') return jsonResponse({ items: [], pagination: emptyPagination })
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<RoleDetailPage roleId="role-1" section="settings" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect((screen.getByLabelText('Key') as HTMLInputElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated role' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated description' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      url: '/api/roles/role-1',
      method: 'PATCH',
      body: { name: 'Updated role', description: 'Updated description' },
    })
    expect(requests[0]!.body).not.toHaveProperty('key')

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText(/Permanently deletes this role and all active and historical assignments/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete role' }))
    await waitFor(() => expect(deleted).toBe(true))
  })

  it('assigns a global role to a selected actor with an exact expiry date and time', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/role-assignments' && request.method === 'POST') {
        requests.push({ ...request, body: await request.body })
        return jsonResponse({ id: 'assignment-1' }, 201)
      }
      if (request.url === '/api/role-assignments') {
        return jsonResponse({ assignments: [], pagination: emptyPagination })
      }
      if (request.url === '/api/roles/role-1/permissions') {
        return rolePermissionsResponse([])
      }
      if (request.url === '/api/roles/role-1') return jsonResponse({ ...role, system: false })
      if (request.url === '/api/api-resources') return jsonResponse({ items: [], pagination: emptyPagination })
      if (request.url === '/api/users') return jsonResponse({ users: [user], pagination })
      if (request.url === '/api/applications') return jsonResponse({ applications: [application], pagination })
      if (request.url === '/api/agents') return jsonResponse({ items: [], pagination: emptyPagination })
      if (request.url === '/api/organizations') {
        return jsonResponse({ organizations: [organization], pagination })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<RoleDetailPage roleId="role-1" section="assignments" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Assign role' }))
    await screen.findByRole('option', { name: 'Jane Doe' })
    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'user-1' } })
    fireEvent.change(screen.getByLabelText('Expires'), { target: { value: 'date' } })
    fireEvent.change(screen.getByLabelText('Expiry date and time'), { target: { value: '2030-01-02T15:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign role' }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      url: '/api/role-assignments',
      method: 'POST',
      body: {
        roleId: 'role-1',
        subjectId: 'user-1',
        subjectType: 'user',
        organizationId: null,
        expiresAt: expect.any(String),
      },
    })
    expect(new Date((requests[0]!.body as { expiresAt: string }).expiresAt).toString()).not.toBe('Invalid Date')
  })
})
