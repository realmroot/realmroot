import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiResourceDetailPage } from '@/features/console/extracted/api-resources'
import { OrganizationTemplatePage } from '@/features/console/extracted/deployment-misc/misc'
import { OrganizationDetailPage } from '@/features/console/extracted/organizations'
import { RoleDetailPage } from '@/features/console/extracted/roles'
import { UserDetailPage } from '@/features/console/extracted/users/user-detail'
import { queryClient } from '@/router'

globalThis.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  queryClient.setDefaultOptions({})
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

import {
  apiPermission,
  apiResource,
  consoleSecurity,
  consoleSharedFetch,
  emptyPagination,
  jsonResponse,
  organization,
  pagination,
  renderWithQuery,
  role,
  summaryCard,
  user,
} from './console.test-utils'

describe('console authorization summaries', () => {
  it('retries organization and organization-template detail loading failures', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/management/organizations/org-1') {
        return Promise.resolve(jsonResponse({ error: 'Organization unavailable.' }, 503))
      }
      if (url === '/api/management/roles') return Promise.resolve(jsonResponse({ error: 'Roles unavailable.' }, 503))
      return consoleSharedFetch(input, init)
    })

    const { unmount } = renderWithQuery(<OrganizationDetailPage organizationId="org-1" />)

    expect(await screen.findByText('Organization unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(requests.filter((url) => url === '/api/management/organizations/org-1').length).toBe(2))

    unmount()
    renderWithQuery(<OrganizationTemplatePage />)

    expect(await screen.findByText('Roles unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(requests.filter((url) => url === '/api/management/roles').length).toBe(2))
  })

  it('loads role permissions after selecting an API resource on a global role', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/roles/role-1') return Promise.resolve(jsonResponse(role))
      if (url === '/api/management/roles/role-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [] }))
      }
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [apiPermission], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<RoleDetailPage roleId="role-1" section="permissions" />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('API resource'), { target: { value: 'resource-1' } })

    expect(await screen.findByText('orders.read')).toBeTruthy()
  })

  it('refetches role permissions after saving permission assignments', async () => {
    const requests: Array<{ url: string; method: string }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      requests.push({ url, method })
      if (url === '/api/management/roles/role-1') {
        return Promise.resolve(jsonResponse({ ...role, resourceId: 'resource-1' }))
      }
      if (url === '/api/management/roles/role-1/permissions') {
        if (method === 'PUT') return Promise.resolve(new Response(null, { status: 204 }))
        return Promise.resolve(jsonResponse({ permissions: [] }))
      }
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [apiPermission], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<RoleDetailPage roleId="role-1" section="permissions" />)

    expect(await screen.findByText('orders.read')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }))

    await waitFor(() =>
      expect(requests.filter((request) => request.url === '/api/management/roles/role-1/permissions')).toEqual([
        { url: '/api/management/roles/role-1/permissions', method: 'GET' },
        { url: '/api/management/roles/role-1/permissions', method: 'PUT' },
        { url: '/api/management/roles/role-1/permissions', method: 'GET' },
      ]),
    )
  })

  it('removes a selected role permission from local assignment state', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method !== 'GET') requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (url === '/api/management/roles/role-1')
        return Promise.resolve(jsonResponse({ ...role, resourceId: 'resource-1' }))
      if (url === '/api/management/roles/role-1/permissions') {
        if (method === 'PUT') return Promise.resolve(new Response(null, { status: 204 }))
        return Promise.resolve(jsonResponse({ permissions: [apiPermission] }))
      }
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [apiPermission], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<RoleDetailPage roleId="role-1" section="permissions" />)

    expect(await screen.findByRole('checkbox')).toHaveProperty('checked', true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }))

    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/roles/role-1/permissions',
        method: 'PUT',
        body: { permissionIds: [] },
      }),
    )
  })

  it('renders detail summary variants for unset and scoped records', async () => {
    let roleDetail = {
      ...role,
      applicationId: 'app-1' as string | null,
      organizationId: null as string | null,
      resourceId: null as string | null,
      system: false,
      tokenClaimName: 'roles' as string | null,
      tokenClaimValue: 'admin' as string | null,
    }
    const disabledOrganization = {
      ...organization,
      displayName: null,
      disabled: true,
      disabledReason: 'Paused by policy',
    }
    const disabledResource = {
      ...apiResource,
      enabled: false,
      tokenClaimsNamespace: 'https://claims.example.com',
    }

    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/users/user-1') {
        return Promise.resolve(
          jsonResponse({
            user: {
              id: 'user-1',
              email: null,
              emailVerified: false,
              username: null,
              role: null,
              banned: true,
              banReason: 'abuse',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          }),
        )
      }
      if (url.startsWith('/api/management/users/user-1/sessions')) {
        return Promise.resolve(jsonResponse({ sessions: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/management/users/user-1/linked-accounts')) {
        return Promise.resolve(jsonResponse({ accounts: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/management/users/user-1/applications')) {
        return Promise.resolve(jsonResponse({ applications: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/users/user-1/security')
        return Promise.resolve(jsonResponse({ security: consoleSecurity }))
      if (url.startsWith('/api/management/users/user-1/passkeys')) {
        return Promise.resolve(jsonResponse({ passkeys: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/organizations/org-1') return Promise.resolve(jsonResponse(disabledOrganization))
      if (url === '/api/management/roles/role-1') return Promise.resolve(jsonResponse(roleDetail))
      if (url === '/api/management/roles/role-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [apiPermission] }))
      }
      if (url === '/api/management/api-resources/resource-1') return Promise.resolve(jsonResponse(disabledResource))
      if (url === '/api/management/api-resources/resource-1/scopes') {
        return Promise.resolve(jsonResponse({ scopes: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [], pagination: emptyPagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<UserDetailPage userId="user-1" />)

    expect(await screen.findByRole('heading', { name: 'user-1' })).toBeTruthy()
    expect(summaryCard('Identity summary').getByText('Not set')).toBeTruthy()
    expect(summaryCard('Identity summary').getByText('user')).toBeTruthy()
    expect(summaryCard('Identity summary').getByText('Banned')).toBeTruthy()
    expect(summaryCard('Identity summary').getAllByText('0').length).toBeGreaterThanOrEqual(3)

    cleanup()
    renderWithQuery(<OrganizationDetailPage organizationId="org-1" />)

    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeTruthy()
    expect(summaryCard('Organization summary').getByText('Acme')).toBeTruthy()
    expect(summaryCard('Organization summary').getByText('Disabled')).toBeTruthy()
    expect(summaryCard('Organization summary').getByText('Paused by policy')).toBeTruthy()

    cleanup()
    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)

    expect(await screen.findByRole('heading', { name: 'Management API' })).toBeTruthy()
    expect(summaryCard('Resource summary').getByText('Disabled')).toBeTruthy()
    expect(summaryCard('Resource summary').getByText('https://claims.example.com')).toBeTruthy()

    cleanup()
    renderWithQuery(<RoleDetailPage roleId="role-1" />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    expect(summaryCard('Role summary').getByText('Application app-1')).toBeTruthy()
    expect(summaryCard('Role summary').getByText('0')).toBeTruthy()
    expect(summaryCard('Role summary').getByText('roles')).toBeTruthy()

    cleanup()
    roleDetail = { ...role, organizationId: 'org-1', resourceId: null, system: false }
    renderWithQuery(<RoleDetailPage roleId="role-1" />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    expect(summaryCard('Role summary').getByText('Organization org-1')).toBeTruthy()

    cleanup()
    roleDetail = { ...role, applicationId: null, organizationId: null, resourceId: null }
    renderWithQuery(<RoleDetailPage roleId="role-1" />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    expect(summaryCard('Role summary').getByText('Tenant')).toBeTruthy()
  })

  it('renders detail summary counts while related detail lists are loading', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/api-resources/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/management/api-resources/resource-1/scopes') return new Promise(() => undefined)
      if (url === '/api/management/api-resources/resource-1/permissions') return new Promise(() => undefined)
      if (url === '/api/management/users/user-1') return Promise.resolve(jsonResponse({ user }))
      if (url.startsWith('/api/management/users/user-1/sessions')) return new Promise(() => undefined)
      if (url.startsWith('/api/management/users/user-1/linked-accounts')) return new Promise(() => undefined)
      if (url.startsWith('/api/management/users/user-1/applications')) return new Promise(() => undefined)
      if (url === '/api/management/users/user-1/security') return new Promise(() => undefined)
      if (url.startsWith('/api/management/users/user-1/passkeys')) return new Promise(() => undefined)
      if (url === '/api/management/roles/role-1') {
        return Promise.resolve(jsonResponse({ ...role, resourceId: 'resource-1' }))
      }
      if (url === '/api/management/roles/role-1/permissions') return new Promise(() => undefined)
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)

    expect(await screen.findByRole('heading', { name: 'Management API' })).toBeTruthy()
    expect(summaryCard('Resource summary').getAllByText('0')).toHaveLength(2)

    cleanup()
    renderWithQuery(<RoleDetailPage roleId="role-1" />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    expect(summaryCard('Role summary').getByText('0')).toBeTruthy()

    cleanup()
    renderWithQuery(<UserDetailPage userId="user-1" />)

    expect(await screen.findByRole('heading', { name: 'Jane Doe' })).toBeTruthy()
    expect(summaryCard('Identity summary').getAllByText('0')).toHaveLength(3)
  })
})
