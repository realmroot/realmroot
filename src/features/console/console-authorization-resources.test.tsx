import type { ApiResource } from '@shared/api/agent-api'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiResourceSummaryCard } from '@/features/console/extracted/api-resource-summary-card'
import { ApiResourceDetailPage, ApiResourcesPage } from '@/features/console/extracted/api-resources'
import {
  ConsolePlaceholderPage,
  CustomizeJwtPage,
  OrganizationTemplatePage,
} from '@/features/console/extracted/deployment-misc/misc'
import { OrganizationDetailPage, OrganizationsPage } from '@/features/console/extracted/organizations'
import { RoleSummaryCard } from '@/features/console/extracted/role-summary-card'
import { RoleDetailPage, RolesPage } from '@/features/console/extracted/roles'
import {
  apiResource,
  emptyPagination,
  jsonResponse,
  organization,
  pagination,
  renderWithQuery,
  role,
} from './console.test-utils'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...original, useNavigate: () => navigate }
})

afterEach(() => {
  cleanup()
  navigate.mockClear()
  vi.restoreAllMocks()
})

function requestParts(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null
  return {
    url: request?.url ? new URL(request.url).pathname : String(input),
    method: request?.method ?? init?.method ?? 'GET',
    body: request?.body ? request.json() : init?.body ? Promise.resolve(JSON.parse(String(init.body))) : null,
  }
}

describe('console API resources and roles', () => {
  it('renders authorization summaries and organization-template utility pages', async () => {
    const roles = [
      role,
      { ...role, id: 'org-role', name: 'Org operator', organizationId: 'org-1' },
      { ...role, id: 'app-role', name: 'App operator', applicationId: 'app-1' },
      { ...role, id: 'resource-role', name: 'Resource operator', resourceId: 'resource-1' },
    ]
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ roles, pagination }))

    renderWithQuery(
      <>
        <ApiResourceSummaryCard resource={{ ...apiResource, enabled: false }} />
        <RoleSummaryCard role={role} scopeCount={0} />
        <RoleSummaryCard role={{ ...role, system: false, resourceId: 'resource-1' }} scopeCount={2} />
        <RoleSummaryCard role={{ ...role, organizationId: 'org-1' }} scopeCount={1} />
        <RoleSummaryCard role={{ ...role, applicationId: 'app-1' }} scopeCount={1} />
      </>,
    )
    expect(screen.getByText('Business OpenAPI')).toBeTruthy()
    expect(screen.getByText('API resource resource-1')).toBeTruthy()
    expect(screen.getByText('Organization org-1')).toBeTruthy()
    expect(screen.getByText('Application app-1')).toBeTruthy()
    expect(screen.getByText('Tenant')).toBeTruthy()

    cleanup()
    renderWithQuery(
      <ConsolePlaceholderPage title="Placeholder" description="Description" rows={[['Mode', 'Native']]} />,
    )
    expect(screen.getByText('Native')).toBeTruthy()

    cleanup()
    renderWithQuery(<CustomizeJwtPage />)
    expect(screen.getByText('Role keys are emitted in the roles claim.')).toBeTruthy()
    expect(screen.getByText('Relevant organization IDs are emitted in the groups claim.')).toBeTruthy()

    cleanup()
    renderWithQuery(<OrganizationTemplatePage />)
    expect(await screen.findByText('Org operator')).toBeTruthy()
    expect(screen.getByText('Global template')).toBeTruthy()
    expect(screen.queryByText('App operator')).toBeNull()
    expect(screen.queryByText('Resource operator')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search organization roles'), { target: { value: 'missing' } })
    expect(screen.queryByText('Org operator')).toBeNull()
  })

  it('retries organization-template role loading', async () => {
    let failed = true
    vi.spyOn(window, 'fetch').mockImplementation(() =>
      Promise.resolve(
        failed ? jsonResponse({ error: 'Roles unavailable.' }, 503) : jsonResponse({ roles: [role], pagination }),
      ),
    )
    renderWithQuery(<OrganizationTemplatePage />)
    expect(await screen.findByText('Roles unavailable.')).toBeTruthy()
    failed = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Admin')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Organization roles' }))

    cleanup()
    renderWithQuery(<OrganizationTemplatePage section={'hidden' as 'organization-roles'} />)
    expect(await screen.findByRole('heading', { name: 'Organization template' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Organization roles', level: 2 })).toBeNull()
  })

  it('filters resource and role inventories across every role scope', async () => {
    const roles = [
      role,
      { ...role, id: 'role-app', key: 'app-reader', name: 'App reader', system: false, applicationId: 'app-1' },
      {
        ...role,
        id: 'role-org',
        key: 'org-admin',
        name: 'Org admin',
        system: false,
        organizationId: 'org-1',
      },
      {
        ...role,
        id: 'role-resource',
        key: 'projects-reader',
        name: 'Projects reader',
        description: null,
        system: false,
        resourceId: 'resource-1',
      },
    ]
    const external = {
      ...apiResource,
      id: 'resource-external',
      identifier: 'projects',
      name: 'Projects API',
      resourceUrl: 'https://projects.example.com/api',
      authorizationMode: 'external' as const,
      enabled: false,
      authorization: null,
    }
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const { url } = requestParts(input)
      if (url === '/api/roles') return Promise.resolve(jsonResponse({ roles, pagination }))
      if (url === '/api/api-resources') {
        return Promise.resolve(jsonResponse({ items: [{ ...apiResource, authorization: null }, external], pagination }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithQuery(<ApiResourcesPage />)
    expect(await screen.findByText('Projects API')).toBeTruthy()
    expect(screen.getByText('External issuer')).toBeTruthy()
    expect(screen.getByText('Disabled')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search API resources'), { target: { value: 'missing' } })
    expect(screen.getByText('No API resources found')).toBeTruthy()

    cleanup()
    renderWithQuery(<RolesPage />)
    expect(await screen.findByText('Projects reader')).toBeTruthy()
    expect(screen.getByText('app-1')).toBeTruthy()
    expect(screen.getByText('org-1')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter role scope'), { target: { value: 'resource' } })
    expect(screen.queryByText('App reader')).toBeNull()
    expect(screen.getByText('Projects reader')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search roles'), { target: { value: 'missing' } })
    expect(screen.getByText('No roles found')).toBeTruthy()
  })

  it('creates external resources and resource-scoped roles', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.method === 'POST') {
        requests.push({ ...request, body: await request.body })
        if (request.url === '/api/api-resources') {
          return jsonResponse({ ...apiResource, authorizationMode: 'external', authorization: null }, 201)
        }
        if (request.url === '/api/roles') return jsonResponse({ ...role, resourceId: 'resource-1' }, 201)
      }
      if (request.url === '/api/api-resources') {
        return jsonResponse({ items: [{ ...apiResource, authorization: null }], pagination })
      }
      if (request.url === '/api/roles') return jsonResponse({ roles: [], pagination: emptyPagination })
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<ApiResourcesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New external resource' }))
    expect(screen.getByRole('heading', { name: 'Create external API resource' })).toBeTruthy()
    for (const [label, value] of [
      ['Identifier', 'projects'],
      ['Name', 'Projects API'],
      ['Resource URL', 'https://projects.example.com/api'],
      ['Description', 'Projects'],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/api-resources',
        method: 'POST',
        body: expect.objectContaining({
          authorizationMode: 'external',
          authorization: { registrationMode: 'dynamic' },
        }),
      }),
    )

    cleanup()
    renderWithQuery(<ApiResourcesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New local resource' }))
    for (const [label, value] of [
      ['Identifier', 'local'],
      ['Name', 'Local API'],
      ['Resource URL', 'https://auth.example.com/local'],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/api-resources',
        method: 'POST',
        body: expect.objectContaining({ authorizationMode: 'native' }),
      }),
    )

    cleanup()
    renderWithQuery(<RolesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New role' }))
    fireEvent.submit(
      screen.getByRole('heading', { name: 'Create role' }).closest('[role="dialog"]')!.querySelector('form')!,
    )
    expect(await screen.findByText(/Invalid input/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'projects-reader' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Projects reader' } })
    fireEvent.change(screen.getByLabelText('API resource'), { target: { value: 'resource-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/roles',
        method: 'POST',
        body: expect.objectContaining({ key: 'projects-reader', resourceId: 'resource-1' }),
      }),
    )
  })

  it('shows validation errors for incomplete resource creation', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ items: [], pagination: emptyPagination }))
    renderWithQuery(<ApiResourcesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New local resource' }))
    fireEvent.submit(
      screen
        .getByRole('heading', { name: 'Create local API resource' })
        .closest('[role="dialog"]')!
        .querySelector('form')!,
    )
    expect(await screen.findByText(/Invalid input/)).toBeTruthy()
  })

  it('updates native resources and configures manual external authorization', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    const external = {
      ...apiResource,
      name: 'Projects API',
      authorizationMode: 'external' as const,
      resourceUrl: 'https://projects.example.com/api',
      authorization: {
        resourceUrl: 'https://projects.example.com/api',
        issuer: 'https://projects.example.com',
        authorizationEndpoint: 'https://projects.example.com/authorize',
        tokenEndpoint: 'https://projects.example.com/token',
        registrationEndpoint: 'https://projects.example.com/register',
        revocationEndpoint: 'https://projects.example.com/revoke',
        jwksUri: 'https://projects.example.com/jwks',
        userInfoEndpoint: 'https://projects.example.com/userinfo',
        registrationMode: 'dynamic' as const,
        clientId: 'realmroot',
        clientSecretConfigured: true as const,
        status: 'active' as const,
        createdAt: apiResource.createdAt,
        updatedAt: apiResource.updatedAt,
      },
    }
    let selected: ApiResource = { ...apiResource, authorization: null }
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/api-resources/resource-1' && request.method === 'GET') {
        return jsonResponse(selected)
      }
      if (request.url === '/api/api-resources/resource-1' && request.method === 'PATCH') {
        requests.push({ ...request, body: await request.body })
        return jsonResponse(selected)
      }
      if (request.url === '/api/api-resources/resource-1' && request.method === 'DELETE') {
        requests.push({ ...request, body: null })
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)
    expect(await screen.findByRole('heading', { name: 'Resource settings' })).toBeTruthy()
    expect(screen.getByText('Business OpenAPI')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated API' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save resource' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/api-resources/resource-1',
        method: 'PATCH',
        body: expect.objectContaining({
          name: 'Updated API',
          resourceUrl: apiResource.resourceUrl,
        }),
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete resource' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/api-resources/resource-1',
        method: 'DELETE',
        body: null,
      }),
    )

    cleanup()
    selected = external
    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)
    expect(await screen.findByText(/Issuer.*https:\/\/projects\.example\.com/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'External API' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save resource' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/api-resources/resource-1',
        method: 'PATCH',
        body: expect.not.objectContaining({ resourceUrl: expect.anything() }),
      }),
    )
    fireEvent.change(screen.getByLabelText('Client registration'), { target: { value: 'manual' } })
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'manual-client' } })
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discover and configure' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/api-resources/resource-1',
        method: 'PATCH',
        body: {
          resourceUrl: 'https://projects.example.com/api',
          authorization: {
            registrationMode: 'manual',
            clientId: 'manual-client',
            clientSecret: 'secret',
          },
        },
      }),
    )
  })

  it('retries resource queries and dynamically configures an unconfigured external resource', async () => {
    let listFailed = true
    let detailFailed = true
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    const external = {
      ...apiResource,
      name: 'Projects API',
      authorizationMode: 'external' as const,
      enabled: false,
      resourceUrl: 'https://projects.example.com/api',
      authorization: null,
    }
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/api-resources' && request.method === 'GET') {
        return listFailed
          ? jsonResponse({ error: 'Resources unavailable.' }, 503)
          : jsonResponse({ items: [external], pagination })
      }
      if (request.url === '/api/api-resources/resource-1' && request.method === 'GET') {
        return detailFailed ? jsonResponse({ error: 'Resource unavailable.' }, 503) : jsonResponse(external)
      }
      if (request.url === '/api/api-resources/resource-1' && request.method === 'PATCH') {
        requests.push({ ...request, body: await request.body })
        return jsonResponse(external)
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<ApiResourcesPage />)
    expect(await screen.findByText('Resources unavailable.')).toBeTruthy()
    listFailed = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Projects API')).toBeTruthy()

    cleanup()
    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)
    expect(await screen.findByText('Resource unavailable.')).toBeTruthy()
    detailFailed = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Enable' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    fireEvent.change(screen.getByLabelText('Protected resource URL'), {
      target: { value: 'https://projects.example.com/api' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Discover and configure' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/api-resources/resource-1',
        method: 'PATCH',
        body: {
          resourceUrl: 'https://projects.example.com/api',
          authorization: { registrationMode: 'dynamic' },
        },
      }),
    )
  })

  it('updates and deletes custom roles while disabling scopes for global roles', async () => {
    const customRole = { ...role, system: false }
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/roles/role-1' && request.method === 'GET') return jsonResponse(customRole)
      if (request.url === '/api/roles/role-1/scopes' && request.method === 'GET') {
        return jsonResponse({ roleId: 'role-1', scopes: [] })
      }
      if (request.url === '/api/roles/role-1' && request.method === 'PATCH') {
        requests.push({ ...request, body: await request.body })
        return jsonResponse({ ...customRole, name: 'Updated role' })
      }
      if (request.url === '/api/roles/role-1' && request.method === 'DELETE') {
        requests.push({ ...request, body: null })
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<RoleDetailPage roleId="role-1" />)
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Updated role' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save role' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/roles/role-1',
        method: 'PATCH',
        body: expect.objectContaining({ name: 'Updated role' }),
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete role' }))
    await waitFor(() => expect(requests).toContainEqual({ url: '/api/roles/role-1', method: 'DELETE', body: null }))

    cleanup()
    renderWithQuery(<RoleDetailPage roleId="role-1" section="scopes" />)
    expect(await screen.findByText('Only resource roles can reference business API scopes.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save scopes' })).toHaveProperty('disabled', true)
  })

  it('updates organization settings and separates organization-owned Agents', async () => {
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/organizations/org-1' && request.method === 'GET') {
        return jsonResponse({
          ...organization,
          displayName: null,
          disabled: true,
          disabledReason: 'Paused by policy',
        })
      }
      if (request.url === '/api/organizations' && request.method === 'GET') {
        return jsonResponse({ organizations: [organization], pagination })
      }
      if (request.url === '/api/organizations/org-1' && request.method === 'PATCH') {
        requests.push(await request.body)
        return jsonResponse(organization)
      }
      if (request.url === '/api/agents') {
        return jsonResponse({
          items: [
            {
              id: 'agent-org',
              issuer: 'https://auth.example.com',
              subject: 'agt_org',
              name: 'Organization Agent',
              homeSpace: { type: 'organization', organizationId: 'org-1' },
              status: 'active',
              retiredAt: null,
              createdAt: organization.createdAt,
              updatedAt: organization.updatedAt,
            },
            {
              id: 'agent-personal',
              issuer: 'https://auth.example.com',
              subject: 'agt_personal',
              name: 'Personal Agent',
              homeSpace: { type: 'personal', userId: 'user-1' },
              status: 'active',
              retiredAt: null,
              createdAt: organization.createdAt,
              updatedAt: organization.updatedAt,
            },
          ],
          pagination,
        })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<OrganizationDetailPage organizationId="org-1" />)
    expect(await screen.findByText('Organization Agent')).toBeTruthy()
    expect(screen.queryByText('Personal Agent')).toBeNull()
    expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated organization' } })
    fireEvent.change(screen.getByLabelText('Disabled reason'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save organization' }))
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          name: 'Updated organization',
          displayName: null,
          disabledReason: null,
        }),
      ),
    )

    cleanup()
    renderWithQuery(<OrganizationDetailPage organizationId="org-1" section="authorization" />)
    expect(await screen.findByText('Use organization-scoped roles from Console roles.')).toBeTruthy()

    cleanup()
    renderWithQuery(<OrganizationsPage />)
    expect(await screen.findByText(organization.name)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search organizations'), { target: { value: 'missing' } })
    expect(screen.getByText('No organizations found')).toBeTruthy()
  })

  it('retries organization details and renders the empty organization Agent state', async () => {
    let failed = true
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const { url } = requestParts(input)
      if (url === '/api/organizations/org-1') {
        return Promise.resolve(
          failed ? jsonResponse({ error: 'Organization unavailable.' }, 503) : jsonResponse(organization),
        )
      }
      if (url === '/api/agents') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    renderWithQuery(<OrganizationDetailPage organizationId="org-1" />)
    expect(await screen.findByText('Organization unavailable.')).toBeTruthy()
    failed = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No organization-owned Agent identities.')).toBeTruthy()
  })

  it('edits role scopes and routes every assignment subject type', async () => {
    const resourceRole = { ...role, system: false, resourceId: 'resource-1' }
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestParts(input, init)
      if (request.url === '/api/roles/role-1' && request.method === 'GET') return jsonResponse(resourceRole)
      if (request.url === '/api/roles/role-1/scopes' && request.method === 'GET') {
        return jsonResponse({ roleId: 'role-1', scopes: ['projects:read'] })
      }
      if (request.method === 'PUT' || request.method === 'POST') {
        requests.push({ ...request, body: await request.body })
        return jsonResponse(request.method === 'PUT' ? { roleId: 'role-1', scopes: ['projects:write'] } : {})
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithQuery(<RoleDetailPage roleId="role-1" section="scopes" />)
    expect(await screen.findByDisplayValue('projects:read')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Scopes'), { target: { value: 'projects:read\n projects:write ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save scopes' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/roles/role-1/scopes',
        method: 'PUT',
        body: { scopes: ['projects:read', 'projects:write'] },
      }),
    )

    cleanup()
    renderWithQuery(<RoleDetailPage roleId="role-1" section="assignments" />)
    expect(await screen.findByRole('heading', { name: 'Assignments' })).toBeTruthy()
    for (const [type, endpoint] of [
      ['user', 'users'],
      ['agent', 'agents'],
      ['application', 'applications'],
      ['member', 'members'],
    ]) {
      fireEvent.change(screen.getByLabelText('Subject type'), { target: { value: type } })
      fireEvent.change(screen.getByLabelText('Subject ID'), { target: { value: `${type}-1` } })
      fireEvent.click(screen.getByRole('button', { name: 'Assign role' }))
      await waitFor(() =>
        expect(requests).toContainEqual({
          url: `/api/roles/assignments/${endpoint}`,
          method: 'POST',
          body: { roleId: 'role-1', subjectId: `${type}-1` },
        }),
      )
    }
  })
})
