import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiResourceDetailPage, ApiResourcesPage } from '@/features/resource-servers/management-resource-servers'
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
  capabilities: { authentication: true, resourceAuthorization: true },
  enabled: true,
  authenticationEnabled: false,
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
  it('binds Organization Workspace Resource servers to their owner [spec: admin-console/organization-console-resource-boundary]', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const request = input instanceof Request ? input : null
      const url = request ? new URL(request.url) : new URL(String(input), window.location.origin)
      requests.push(`${url.pathname}${url.search}`)
      if (url.pathname === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [apiResource], pagination }))
      }
      if (url.pathname === '/api/connectors') {
        return Promise.resolve(jsonResponse({ items: [genericConnector], pagination }))
      }
      if (url.pathname === '/api/organizations') {
        return Promise.resolve(jsonResponse({ items: [organization], pagination }))
      }
      throw new Error(`Unexpected request: ${url.pathname}${url.search}`)
    })

    renderWithQuery(<ApiResourcesPage organizationId={organization.id} />)

    const resourceLink = await screen.findByRole('link', { name: apiResource.name })
    expect(resourceLink.getAttribute('href')).toBe(
      `/organizations/${organization.id}/resource-servers/${apiResource.id}`,
    )
    expect(screen.queryByLabelText('Filter owner')).toBeNull()
    expect(requests).toContain(`/api/resource-servers?ownerOrganizationId=${organization.id}`)
    fireEvent.click(screen.getByRole('button', { name: 'New resource server' }))
    expect(screen.queryByLabelText('Owner Organization')).toBeNull()
  })

  it('renders and filters the unified Resource server inventory', async () => {
    const external = {
      ...apiResource,
      id: 'resource-external',
      name: 'Projects API',
      resourceUrl: 'https://projects.example.com/api',
      authorizationModel: 'federated' as const,
      providerConnection: { connectorId: 'connector-1', mode: 'managed' as const },
      enabled: false,
    }
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const { url } = requestParts(input)
      if (url === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [apiResource, external], pagination }))
      }
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ items: [genericConnector], pagination }))
      }
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ items: [organization], pagination }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(<ApiResourcesPage organizationId={organization.id} />)

    expect(await screen.findByText('Projects API')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Authorization' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Protected resource' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Owner' })).toBeTruthy()
    expect(screen.getAllByText('Federated').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Filter authorization'), { target: { value: 'realmroot' } })
    expect(screen.queryByText('Projects API')).toBeNull()
    expect(screen.getByText('Management API')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search resource servers'), { target: { value: 'missing' } })
    expect(screen.getByText('No resource servers found')).toBeTruthy()
  })

  it('creates an externally authorized Resource server with explicit ownership and visibility [spec: agent-identity/external-api-resource-registration]', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/resource-servers' && request.method === 'POST') {
        requests.push({ ...request, body: await request.body })
        return jsonResponse(
          {
            ...apiResource,
            name: 'Projects API',
            authorizationModel: 'federated',
            providerConnection: { connectorId: 'connector-1', mode: 'managed' as const },
          },
          201,
        )
      }
      if (request.url === '/api/resource-servers') {
        return jsonResponse({ items: [], pagination: emptyPagination })
      }
      if (request.url === '/api/connectors') {
        return jsonResponse({ items: [genericConnector], pagination })
      }
      if (request.url === '/api/organizations') {
        return jsonResponse({ items: [organization], pagination })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<ApiResourcesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New resource server' }))
    expect(screen.getByRole('heading', { name: 'New resource server' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Identifier'), { target: { value: 'projects' } })
    fireEvent.change(screen.getByLabelText('Protected resource URL'), {
      target: { value: 'https://projects.example.com/api' },
    })
    fireEvent.focus(screen.getByRole('button', { name: 'Authorization help' }))
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'Agents call this Resource Server with a token issued by Realmroot.',
    )
    fireEvent.change(screen.getByLabelText('Authorization'), { target: { value: 'federated' } })
    await waitFor(() =>
      expect(screen.getByRole('tooltip').textContent).toBe(
        'Agents call the external Resource Server with its authorization server’s token.',
      ),
    )
    fireEvent.change(screen.getByLabelText('Provider connector'), { target: { value: 'connector-1' } })
    fireEvent.change(screen.getByLabelText('Authorization detail templates'), { target: { value: '{' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/JSON/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Authorization detail templates'), {
      target: {
        value: JSON.stringify([{ type: 'project_access', actions: ['read'], project_id: 'project-1' }]),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          url: '/api/resource-servers',
          method: 'POST',
          body: {
            identifier: 'projects',
            resourceUrl: 'https://projects.example.com/api',
            authorizationModel: 'federated',
            providerConnection: { connectorId: 'connector-1', mode: 'managed' as const },
            authorizationDetails: [{ type: 'project_access', actions: ['read'], project_id: 'project-1' }],
            ownerOrganizationId: 'org-1',
            visibility: 'private',
            availableToAgents: true,
          },
        },
      ]),
    )
  })

  it('filters active lifecycle states and creates a Resource server for selected Organizations', async () => {
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
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/resource-servers' && request.method === 'POST') {
        requests.push(await request.body)
        return jsonResponse({ ...apiResource, id: 'resource-created', name: 'Selected API' }, 201)
      }
      if (request.url === '/api/resource-servers') {
        return jsonResponse({ items: [apiResource, disabledResource], pagination })
      }
      if (request.url === '/api/connectors') {
        return jsonResponse({ items: [genericConnector], pagination })
      }
      if (request.url === '/api/organizations') {
        return jsonResponse({ items: [organization, betaOrganization], pagination })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<ApiResourcesPage />)
    expect(await screen.findByText('Disabled API')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter status'), { target: { value: 'disabled' } })
    expect(screen.getByText('Disabled API')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter owner'), { target: { value: betaOrganization.id } })
    expect(await screen.findByText('Disabled API')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'New resource server' }))
    expect(screen.getByLabelText('Provider connection')).toHaveProperty('value', 'none')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'New resource server' }))
    fireEvent.change(screen.getByLabelText('Identifier'), { target: { value: 'selected-api' } })
    fireEvent.change(screen.getByLabelText('Protected resource URL'), {
      target: { value: 'https://selected.example.com/api' },
    })
    fireEvent.change(screen.getByLabelText('Provider connection'), { target: { value: 'managed' } })
    fireEvent.change(screen.getByLabelText('Provider connector'), { target: { value: genericConnector.id } })
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: betaOrganization.id } })
    fireEvent.change(screen.getByLabelText('Visibility'), { target: { value: 'public' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Available to Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          identifier: 'selected-api',
          resourceUrl: 'https://selected.example.com/api',
          authorizationModel: 'realmroot',
          providerConnection: { connectorId: genericConnector.id, mode: 'managed' as const },
          authorizationDetails: [],
          ownerOrganizationId: betaOrganization.id,
          visibility: 'public',
          availableToAgents: false,
        },
      ]),
    )
  })

  it('shows protected endpoints and their required scopes as a dedicated detail tab', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const { url } = requestParts(input)
      if (url === '/api/resource-servers/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/resource-servers/resource-1/contract') return Promise.resolve(jsonResponse(contract))
      if (url === '/api/connectors') return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ items: [organization], pagination }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" section="endpoints" />)

    expect(await screen.findByRole('heading', { name: 'Management API' })).toBeTruthy()
    expect(screen.getByText('List projects')).toBeTruthy()
    expect(screen.getByText('/projects')).toBeTruthy()
    expect(screen.getByText('projects:read')).toBeTruthy()
    expect(screen.getByText('Returns visible projects.')).toBeTruthy()
    expect(screen.queryByText(contract.sourceUrl)).toBeNull()
  })

  it('manages the synchronized scope registry from its own detail tab', async () => {
    const resourceWithScopes = {
      ...apiResource,
      scopeRegistry: {
        ...apiResource.scopeRegistry,
        scopes: [{ value: 'projects:read', description: 'Read projects', grantMode: 'assigned' as const }],
      },
    }
    const updates: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/resource-servers/resource-1' && request.method === 'GET') {
        return jsonResponse(resourceWithScopes)
      }
      if (request.url === '/api/resource-servers/resource-1' && request.method === 'PATCH') {
        updates.push(await request.body)
        return jsonResponse(resourceWithScopes)
      }
      if (request.url === '/api/connectors') return jsonResponse({ items: [], pagination: emptyPagination })
      if (request.url === '/api/organizations') {
        return jsonResponse({ items: [organization], pagination })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" section="scopes" />)

    expect(await screen.findByRole('heading', { name: 'Scope registry' })).toBeTruthy()
    expect(screen.getByText('Read projects')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Grant mode for projects:read'), { target: { value: 'automatic' } })

    await waitFor(() => {
      expect(updates).toEqual([{ scopeGrantModes: [{ scope: 'projects:read', grantMode: 'automatic' }] }])
    })
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
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ items: [organization], pagination }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)
    expect(
      (await screen.findAllByRole('button', { name: 'Realmroot authorization model help' })).length,
    ).toBeGreaterThan(0)
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Endpoints' }), { button: 0, ctrlKey: false })
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

  it('edits Resource server ownership and visibility from its settings section', async () => {
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
      visibility: 'public',
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
        return jsonResponse({ items: [], pagination: emptyPagination })
      }
      if (request.url === '/api/organizations') {
        return jsonResponse({ items: [organization, betaOrganization], pagination })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)
    expect(await screen.findByText('All authenticated users and Organizations')).toBeTruthy()
    expect(screen.getByText('No')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Settings' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('Not configured')).toBeTruthy()

    const access = screen.getByRole('heading', { name: 'Ownership & access' }).closest('section') as HTMLElement
    fireEvent.click(within(access).getByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByLabelText('Owner'), { target: { value: betaOrganization.id } })
    fireEvent.click(screen.getByRole('switch', { name: 'Available to Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(requests).toContainEqual({
        ownerOrganizationId: betaOrganization.id,
        visibility: 'public',
        availableToAgents: true,
      }),
    )
    fireEvent.click(within(access).getByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByLabelText('Visibility'), { target: { value: 'private' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        ownerOrganizationId: betaOrganization.id,
        visibility: 'private',
        availableToAgents: true,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
    await waitFor(() => expect(requests).toContainEqual({ enabled: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('shows incomplete external authorization without inventing provider state', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const { url } = requestParts(input)
      if (url === '/api/resource-servers/resource-1') {
        return Promise.resolve(
          jsonResponse({
            ...apiResource,
            authorizationModel: 'federated',
            providerConnection: { connectorId: 'connector-1', mode: 'managed' as const },
            authorization: null,
          }),
        )
      }
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ items: [organization], pagination }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)
    expect((await screen.findAllByText('Federated')).length).toBeGreaterThan(0)
    fireEvent.focus(screen.getAllByRole('button', { name: 'Federated authorization model help' })[0])
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'Agents call the external Resource Server with its authorization server’s token.',
    )
    expect(screen.getAllByText('Not configured')).toHaveLength(3)
    expect(await screen.findByText('Visibility')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Settings' }), { button: 0, ctrlKey: false })
    expect(await screen.findByRole('heading', { name: 'Provider access' })).toBeTruthy()
    expect(screen.getByText('connector-1')).toBeTruthy()
    expect(screen.getByText('Pending validation')).toBeTruthy()
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
          items: [genericConnector, { ...genericConnector, id: 'connector-2', displayName: 'Projects OIDC 2' }],
          pagination,
        })
      }
      if (request.url === '/api/organizations') {
        return jsonResponse({ items: [organization], pagination })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<ApiResourceDetailPage organizationId="org-1" resourceId="resource-1" section="settings" />)
    expect(
      (await screen.findAllByRole('button', { name: 'Realmroot authorization model help' })).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { name: 'Provider access' })).toBeNull()
    const details = screen.getByRole('heading', { name: 'Resource server details' }).closest('section') as HTMLElement
    fireEvent.click(within(details).getByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByLabelText('Identifier'), { target: { value: 'updated-api' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/resource-servers/resource-1',
        method: 'PATCH',
        body: {
          identifier: 'updated-api',
          resourceUrl: apiResource.resourceUrl,
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
    selected = { ...apiResource, providerConnection: { connectorId: 'connector-1', mode: 'managed' as const } }
    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" section="settings" />)
    const delegatedProvider = await screen.findByRole('heading', { name: 'Provider access' })
    const delegatedProviderSection = delegatedProvider.closest('section') as HTMLElement
    expect(
      within(delegatedProviderSection).getByText('Realmroot manages the Provider Connection credentials.'),
    ).toBeTruthy()
    expect(within(delegatedProviderSection).queryByText('Authorization detail templates')).toBeNull()
    fireEvent.click(within(delegatedProviderSection).getByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByLabelText('Provider connector'), { target: { value: 'connector-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/resource-servers/resource-1',
        method: 'PATCH',
        body: {
          providerConnection: { connectorId: 'connector-2', mode: 'managed' },
          authorizationDetails: [],
        },
      }),
    )
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Overview' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('Managed by Realmroot')).toBeTruthy()

    cleanup()
    selected = {
      ...apiResource,
      authorizationModel: 'federated',
      providerConnection: { connectorId: 'connector-1', mode: 'managed' as const },
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
    expect(
      (await screen.findAllByRole('button', { name: 'Federated authorization model help' })).length,
    ).toBeGreaterThan(0)
    const provider = screen.getByRole('heading', { name: 'Provider access' }).closest('section') as HTMLElement
    fireEvent.click(within(provider).getByRole('button', { name: 'Edit' }))
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
          providerConnection: { connectorId: 'connector-1', mode: 'managed' },
          authorizationDetails: [{ type: 'project_access', actions: ['read'], project_id: 'project-1' }],
        },
      }),
    )
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Overview' }), { button: 0, ctrlKey: false })
    expect((await screen.findAllByText('https://projects.example.com')).length).toBeGreaterThan(0)
    expect(screen.getByText('active')).toBeTruthy()
    expect(screen.getByText('manual')).toBeTruthy()
  })

  it('[spec: admin-console/admin-delete-api-resource] soft-deletes a Resource server without a restore path', async () => {
    const requests: Array<{ url: string; method: string }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/resource-servers/resource-1' && request.method === 'DELETE') {
        requests.push({ url: request.url, method: request.method })
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (request.url === '/api/resource-servers/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (request.url === '/api/connectors')
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      if (request.url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ items: [organization], pagination }))
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    const scoped = renderWithQuery(
      <ApiResourceDetailPage organizationId="org-1" resourceId="resource-1" section="settings" />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/revokes active connections, grants, pending requests/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete resource server' }))

    await waitFor(() => expect(requests).toEqual([{ url: '/api/resource-servers/resource-1', method: 'DELETE' }]))
    expect(navigate).toHaveBeenCalled()

    scoped.unmount()
    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" section="settings" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete resource server' }))
    await waitFor(() => expect(requests).toHaveLength(2))
  })

  it('rejects a Resource Server detail route under a different Organization', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const { url } = requestParts(input)
      if (url === '/api/resource-servers/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ items: [organization], pagination }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(<ApiResourceDetailPage organizationId="org-other" resourceId="resource-1" />)

    expect(await screen.findByText('Resource server does not belong to this Organization.')).toBeTruthy()
  })
})

import type { ApiResource } from '@shared/api/agent-api'
