import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrganizationsPage } from '@/features/console/extracted/organizations'
import { ApiResourcesPage } from '@/features/resource-servers/management-resource-servers'
import { RolesPage } from '@/features/roles/management-roles'
import { queryClient } from '@/router'
import {
  apiResource,
  consoleSharedFetch,
  emptyPagination,
  jsonResponse,
  organization,
  pagination,
  renderWithQuery,
  role,
} from './console.test-utils'

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

describe('admin console authorization creation and Organization detail', () => {
  it('creates Organizations, Organization Roles, and Resource servers from secondary dialogs [spec: admin-console/admin-create-organization] [spec: admin-console/admin-create-role] [spec: admin-console/admin-create-api-resource]', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input).split('?')[0]
      if (
        ['/api/organizations', '/api/organizations/org-1/roles', '/api/resource-servers'].includes(url) &&
        init?.method === 'POST'
      ) {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        if (url === '/api/organizations') return Promise.resolve(jsonResponse(organization, 201))
        if (url === '/api/organizations/org-1/roles') return Promise.resolve(jsonResponse(role, 201))
        return Promise.resolve(jsonResponse(apiResource, 201))
      }
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ items: [organization], pagination }))
      }
      if (url === '/api/organizations/org-1/members') {
        return Promise.resolve(jsonResponse({ members: [], pagination: emptyPagination }))
      }
      if (url === '/api/organizations/org-1/roles') return Promise.resolve(jsonResponse({ items: [role], pagination }))
      if (url === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [{ ...apiResource, authorization: null }], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    const { unmount } = renderWithQuery(<OrganizationsPage />)
    expect(await screen.findByText('Acme Inc.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Provision organization' }))
    fireEvent.change(await screen.findByLabelText('Slug'), { target: { value: 'northwind' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Northwind Traders' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(requests).toHaveLength(1))

    unmount()
    renderWithQuery(<RolesPage organizationId="org-1" />)
    expect(await screen.findByText('Admin')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    fireEvent.change(await screen.findByLabelText('Key'), { target: { value: 'auditor' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Auditor' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Reads audit events' } })
    expect(screen.queryByLabelText('Scopes')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(requests).toHaveLength(2))

    unmount()
    renderWithQuery(<ApiResourcesPage />)
    expect(await screen.findByText('Management API')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New resource server' }))
    fireEvent.change(await screen.findByLabelText('Identifier'), { target: { value: 'billing-api' } })
    fireEvent.change(screen.getByLabelText('Protected resource URL'), {
      target: { value: 'https://billing.example.com' },
    })
    expect(screen.getByLabelText('Authorization')).toHaveProperty('value', 'native')
    expect(screen.getByLabelText('Visibility')).toHaveProperty('value', 'private')
    expect(screen.getByRole('switch', { name: 'Available to Agents' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(requests).toEqual([
        { url: '/api/organizations', body: { slug: 'northwind', name: 'Northwind Traders' } },
        {
          url: '/api/organizations/org-1/roles',
          body: { key: 'auditor', displayName: 'Auditor', description: 'Reads audit events', scopes: [] },
        },
        {
          url: '/api/resource-servers',
          body: {
            identifier: 'billing-api',
            resourceUrl: 'https://billing.example.com',
            authorizationModel: 'native',
            connectorId: null,
            authorizationDetails: [],
            ownerOrganizationId: 'org-1',
            visibility: 'private',
            availableToAgents: true,
          },
        },
      ]),
    )
  })
})
