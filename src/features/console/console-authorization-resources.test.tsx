import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiResourceDetailPage, ApiResourcesPage } from '@/features/console/extracted/api-resources'
import { ConsolePlaceholderPage } from '@/features/console/extracted/deployment-misc/misc'
import { RoleDetailPage, RolesPage } from '@/features/console/extracted/roles'
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
  apiScope,
  consoleSharedFetch,
  emptyPagination,
  jsonResponse,
  pagination,
  renderWithQuery,
  role,
  summaryCard,
} from './console.test-utils'

describe('console authorization resources', () => {
  it('renders console placeholder rows', () => {
    render(
      <ConsolePlaceholderPage
        title="Placeholder module"
        description="Placeholder description"
        rows={[
          ['Support', 'Unavailable in this plan'],
          ['Status', 'Configuration only'],
        ]}
      />,
    )

    expect(screen.getAllByRole('heading', { name: 'Placeholder module' })).toHaveLength(2)
    expect(screen.getByText('Support')).toBeTruthy()
    expect(screen.getByText('Unavailable in this plan')).toBeTruthy()
    expect(screen.getByText('Status')).toBeTruthy()
    expect(screen.getByText('Configuration only')).toBeTruthy()
  })

  it('shows client-side validation errors for simple create dialogs', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/roles' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(role, 201))
      }
      if (url === '/api/management/roles') return Promise.resolve(jsonResponse({ roles: [role], pagination }))
      if (url === '/api/management/api-resources' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(apiResource, 201))
      }
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    const { unmount } = renderWithQuery(<RolesPage />)

    expect(await screen.findByText('Admin')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'auditor' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)

    expect(await screen.findByText('Invalid input: expected string, received undefined')).toBeTruthy()
    expect(requests).toEqual([])

    unmount()
    renderWithQuery(<ApiResourcesPage />)

    expect(await screen.findByText('Management API')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New resource' }))
    fireEvent.change(screen.getByLabelText('Identifier'), { target: { value: 'billing-api' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)

    expect(await screen.findByText('Invalid input: expected string, received undefined')).toBeTruthy()
    expect(requests).toEqual([])
  })

  it('manages API resource scopes, permissions, role permissions, and assignments from detail pages', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method !== 'GET') requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (url === '/api/management/api-resources/resource-1' && method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...apiResource, ...JSON.parse(String(init?.body)) }))
      }
      if (url === '/api/management/api-resources/resource-1' && method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/management/api-resources/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/management/api-resources/resource-1/scopes') {
        if (method === 'POST') return Promise.resolve(jsonResponse(apiScope, 201))
        return Promise.resolve(jsonResponse({ scopes: [apiScope], pagination }))
      }
      if (url === '/api/management/api-resources/resource-1/scopes/scope-1')
        return Promise.resolve(jsonResponse(apiScope))
      if (url === '/api/management/api-resources/resource-1/permissions') {
        if (method === 'POST') return Promise.resolve(jsonResponse(apiPermission, 201))
        return Promise.resolve(jsonResponse({ permissions: [apiPermission], pagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions/permission-1') {
        return Promise.resolve(jsonResponse(apiPermission))
      }
      if (url === '/api/management/roles/role-1')
        return Promise.resolve(jsonResponse({ ...role, resourceId: 'resource-1' }))
      if (url === '/api/management/roles/role-1/permissions') {
        if (method === 'PUT') return Promise.resolve(new Response(null, { status: 204 }))
        return Promise.resolve(jsonResponse({ permissions: [] }))
      }
      if (url === '/api/management/roles') return Promise.resolve(jsonResponse({ roles: [role], pagination }))
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/user-role-assignments') return Promise.resolve(new Response(null, { status: 204 }))
      if (url === '/api/management/application-role-assignments')
        return Promise.resolve(new Response(null, { status: 204 }))
      if (url === '/api/management/member-role-assignments') return Promise.resolve(new Response(null, { status: 204 }))
      return consoleSharedFetch(input, init)
    })

    const { unmount } = renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)

    expect(await screen.findByRole('heading', { name: 'Management API' })).toBeTruthy()
    expect(summaryCard('Resource summary').getByText('resource-1')).toBeTruthy()
    expect(summaryCard('Resource summary').getByText('management-api')).toBeTruthy()
    expect(summaryCard('Resource summary').getByText('https://auth.example.com/api/management')).toBeTruthy()
    expect(summaryCard('Resource summary').getByText('Enabled')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1',
        method: 'PATCH',
        body: { enabled: false },
      }),
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Scopes' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), { target: { value: 'orders:write' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create scope' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1/scopes',
        method: 'POST',
        body: { value: 'orders:write' },
      }),
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Permissions' }))
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'orders.write' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create permission' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1/permissions',
        method: 'POST',
        body: { key: 'orders.write' },
      }),
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Scopes' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!)
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1/scopes/scope-1',
        method: 'PATCH',
        body: { value: 'orders:read', description: 'Read orders' },
      }),
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!)
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1/scopes/scope-1',
        method: 'DELETE',
        body: null,
      }),
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Permissions' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' }).at(-1)!)
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!)
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1/permissions/permission-1',
        method: 'PATCH',
        body: {
          key: 'orders.read',
          description: 'Read orders',
          scopeId: 'scope-1',
          tokenClaimValue: 'read',
        },
      }),
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!)
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1/permissions/permission-1',
        method: 'DELETE',
        body: null,
      }),
    )

    unmount()
    renderWithQuery(<RoleDetailPage roleId="role-1" section="permissions" />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    expect(summaryCard('Role summary').getByText('role-1')).toBeTruthy()
    expect(summaryCard('Role summary').getByText('admin')).toBeTruthy()
    expect(summaryCard('Role summary').getByText('API resource resource-1')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('orders.read')).toBeTruthy())
    expect(summaryCard('Role summary').getByText('Permissions')).toBeTruthy()
    expect(summaryCard('Role summary').getByText('0')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/roles/role-1/permissions',
        method: 'PUT',
        body: { permissionIds: ['permission-1'] },
      }),
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Assignments' }))
    fireEvent.change(screen.getByLabelText('Subject ID'), { target: { value: 'user-1' } })
    fireEvent.change(screen.getByLabelText('Token claims JSON'), { target: { value: 'not-json' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign role' }))
    expect(await screen.findByText(/Unexpected token/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Token claims JSON'), { target: { value: '{"tier":"gold"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign role' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/user-role-assignments',
        method: 'POST',
        body: { roleId: 'role-1', subjectId: 'user-1', tokenClaims: { tier: 'gold' } },
      }),
    )
    fireEvent.change(screen.getByLabelText('Subject type'), { target: { value: 'application' } })
    fireEvent.change(screen.getByLabelText('Subject ID'), { target: { value: 'app-1' } })
    fireEvent.change(screen.getByLabelText('Token claims JSON'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign role' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/application-role-assignments',
        method: 'POST',
        body: { roleId: 'role-1', subjectId: 'app-1' },
      }),
    )
    fireEvent.change(screen.getByLabelText('Subject type'), { target: { value: 'member' } })
    fireEvent.change(screen.getByLabelText('Subject ID'), { target: { value: 'member-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign role' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/member-role-assignments',
        method: 'POST',
        body: { roleId: 'role-1', subjectId: 'member-1' },
      }),
    )
  })

  it('updates and deletes authorization roles and resources', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method !== 'GET') requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (url === '/api/management/api-resources/resource-1' && method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...apiResource, ...JSON.parse(String(init?.body)) }))
      }
      if (url === '/api/management/api-resources/resource-1' && method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/management/api-resources/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/management/api-resources/resource-1/scopes') {
        return Promise.resolve(jsonResponse({ scopes: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/roles/role-1' && method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...role, system: false, ...JSON.parse(String(init?.body)) }))
      }
      if (url === '/api/management/roles/role-1' && method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/management/roles/role-1') {
        return Promise.resolve(jsonResponse({ ...role, system: false, resourceId: 'resource-1' }))
      }
      if (url === '/api/management/roles/role-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [] }))
      }
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [], pagination: emptyPagination }))
      }
      return consoleSharedFetch(input, init)
    })

    const { unmount } = renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)

    expect(await screen.findByRole('heading', { name: 'Management API' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Orders API' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save resource' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1',
        method: 'PATCH',
        body: {
          identifier: 'management-api',
          name: 'Orders API',
          description: 'Management surface',
          audience: 'https://auth.example.com/api/management',
          tokenClaimsNamespace: null,
        },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete resource' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1',
        method: 'DELETE',
        body: null,
      }),
    )

    unmount()
    renderWithQuery(<RoleDetailPage roleId="role-1" />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Operator' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save role' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/roles/role-1',
        method: 'PATCH',
        body: { key: 'admin', name: 'Operator', description: 'Tenant administrator' },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete role' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/roles/role-1',
        method: 'DELETE',
        body: null,
      }),
    )
  })
})
