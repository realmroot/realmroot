import type { ApiResource } from '@shared/api/agent-api'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiResourceDetailPage, ApiResourcesPage } from '@/features/console/extracted/api-resources'
import { ConsoleScopeProvider } from '@/lib/console-context'
import {
  apiResource,
  emptyPagination,
  jsonResponse,
  organization,
  pagination,
  renderWithQuery,
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

function _rolePermissionsResponse(permissions: Array<{ resourceId: string; scope: string }>) {
  return jsonResponse({ roleId: 'role-1', scopes: permissions }, 200, { etag: '"permissions-v1"' })
}

describe('console API resources and roles', () => {
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
      if (url === '/api/resource-servers') {
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
      if (request.url === '/api/resource-servers' && request.method === 'POST') {
        requests.push({ ...request, body: await request.body })
        return jsonResponse({ ...apiResource, name: 'Projects API', connectorId: 'connector-1' }, 201)
      }
      if (request.url === '/api/resource-servers') {
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
          url: '/api/resource-servers',
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
      if (request.url === '/api/resource-servers' && request.method === 'POST') {
        requests.push(await request.body)
        return jsonResponse({ ...apiResource, id: 'resource-created', name: 'Selected API' }, 201)
      }
      if (request.url === '/api/resource-servers') {
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
      if (url === '/api/resource-servers/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/resource-servers/resource-1/contract') return Promise.resolve(jsonResponse(contract))
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
      if (url === '/api/resource-servers/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/resource-servers/resource-1/contract') {
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
      if (request.url === '/api/resource-servers/resource-1' && request.method === 'PATCH') {
        const body = await request.body
        requests.push(body)
        selected = { ...selected, ...(body as Partial<ApiResource>) }
        return jsonResponse(selected)
      }
      if (request.url === '/api/resource-servers/resource-1') return jsonResponse(selected)
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
      if (url === '/api/resource-servers/resource-1') {
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

  it('shows Organization Roles that grant scopes from a native Resource Server', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const { url } = requestParts(input)
      if (url === '/api/resource-servers/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination: emptyPagination }))
      }
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
      }
      if (url === `/api/organizations/${organization.id}/roles`) {
        return Promise.resolve(
          jsonResponse({
            roles: [
              {
                key: 'operator',
                displayName: 'Operator',
                description: null,
                predefined: false,
                scopes: [
                  { resourceId: apiResource.id, scope: 'projects:read' },
                  { resourceId: 'resource-2', scope: 'other:read' },
                ],
                createdAt: apiResource.createdAt,
                updatedAt: apiResource.updatedAt,
              },
              {
                key: 'unrelated',
                displayName: 'Unrelated',
                description: null,
                predefined: false,
                scopes: [{ resourceId: 'resource-2', scope: 'other:read' }],
                createdAt: apiResource.createdAt,
                updatedAt: apiResource.updatedAt,
              },
            ],
            pagination,
          }),
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: organization.id, realmOperator: false }}>
        <ApiResourceDetailPage resourceId="resource-1" section="authority" />
      </ConsoleScopeProvider>,
    )
    expect(await screen.findByText('Human members only')).toBeTruthy()
    expect(screen.getByText('Operator')).toBeTruthy()
    expect(screen.getByText('projects:read')).toBeTruthy()
    expect(screen.queryByText('Unrelated')).toBeNull()
  })

  it('retries Organization Role loading and renders an empty native authority', async () => {
    let attempts = 0
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const { url } = requestParts(input)
      if (url === '/api/resource-servers/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination: emptyPagination }))
      }
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
      }
      if (url === `/api/organizations/${organization.id}/roles`) {
        attempts += 1
        return Promise.resolve(
          attempts === 1
            ? jsonResponse({ message: 'Roles unavailable.' }, 503)
            : jsonResponse({ roles: [], pagination: emptyPagination }),
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: organization.id, realmOperator: false }}>
        <ApiResourceDetailPage resourceId="resource-1" section="authority" />
      </ConsoleScopeProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No Roles use this server')).toBeTruthy()
  })

  it('uses section-level editors and preserves native/external authorization differences', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    let selected: ApiResource = apiResource
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/resource-servers/resource-1' && request.method === 'PATCH') {
        const body = await request.body
        requests.push({ ...request, body })
        selected = { ...selected, ...(body as Partial<ApiResource>) }
        return jsonResponse(selected)
      }
      if (request.url === '/api/resource-servers/resource-1') return jsonResponse(selected)
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
        url: '/api/resource-servers/resource-1',
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
        url: '/api/resource-servers/resource-1',
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
        url: '/api/resource-servers/resource-1',
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
      if (request.url === '/api/resource-servers/resource-1/archival' && request.method === 'PUT') {
        requests.push({ url: request.url, method: request.method })
        selected = { ...selected, enabled: false, archivedAt: '2026-07-30T19:00:00.000Z' }
        return Promise.resolve(jsonResponse(selected))
      }
      if (request.url === '/api/resource-servers/resource-1/archival' && request.method === 'DELETE') {
        requests.push({ url: request.url, method: request.method })
        selected = { ...selected, enabled: false, archivedAt: null }
        return Promise.resolve(jsonResponse(selected))
      }
      if (request.url === '/api/resource-servers/resource-1') return Promise.resolve(jsonResponse(selected))
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
      { url: '/api/resource-servers/resource-1/archival', method: 'PUT' },
      { url: '/api/resource-servers/resource-1/archival', method: 'DELETE' },
    ])
  })
})
