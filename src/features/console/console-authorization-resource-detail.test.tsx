import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiResourceDetailPage } from '@/features/console/extracted/api-resources'
import { RoleDetailPage } from '@/features/console/extracted/roles'
import { AppRouter, queryClient } from '@/router'

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
  apiResource,
  brandingSettings,
  configz,
  consoleAccountProfile,
  consoleSharedFetch,
  emptyPagination,
  jsonResponse,
  pagination,
  renderWithQuery,
  role,
  signInSettings,
} from './console.test-utils'

describe('console authorization resource detail', () => {
  it('redirects after deleting authorization details from routed pages', async () => {
    const requests: Array<{ url: string; method: string }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method !== 'GET') requests.push({ url, method })
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: consoleAccountProfile }))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
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
      if (url === '/api/management/api-resources/resource-1' && method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/management/api-resources/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/api-resources/resource-1/scopes') {
        return Promise.resolve(jsonResponse({ scopes: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [], pagination: emptyPagination }))
      }
      return consoleSharedFetch(input, init)
    })

    window.history.pushState(null, '', '/console/roles/role-1')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete role' }))
    await waitFor(() => expect(window.location.pathname).toBe('/console/roles'))
    expect(requests).toContainEqual({ url: '/api/management/roles/role-1', method: 'DELETE' })

    cleanup()
    queryClient.clear()
    window.history.pushState(null, '', '/console/api-resources/resource-1')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Management API' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete resource' }))
    await waitFor(() => expect(window.location.pathname).toBe('/console/api-resources'))
    expect(requests).toContainEqual({ url: '/api/management/api-resources/resource-1', method: 'DELETE' })
  })

  it('renders empty authorization detail rows and inline validation errors', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/api-resources/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/management/api-resources/resource-1/scopes') {
        return Promise.resolve(jsonResponse({ scopes: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [], pagination: emptyPagination }))
      }
      return consoleSharedFetch(input, init)
    })

    const { unmount } = renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" section="scopes" />)

    expect(await screen.findByText('No scopes yet.')).toBeTruthy()

    fireEvent.submit(screen.getByRole('button', { name: 'Create scope' }).closest('form')!)

    expect(await screen.findByText('Invalid input: expected string, received undefined')).toBeTruthy()
    unmount()
    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" section="permissions" />)

    expect(await screen.findByText('No permissions yet.')).toBeTruthy()
  })

  it('renders resource, scope, and permission detail with absent optional fields', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/api-resources/resource-1') {
        return Promise.resolve(
          jsonResponse({ ...apiResource, description: null, tokenClaimsNamespace: null, enabled: false }),
        )
      }
      if (url === '/api/management/api-resources/resource-1/scopes') {
        return Promise.resolve(
          jsonResponse({
            scopes: [
              {
                id: 'scope-1',
                resourceId: 'resource-1',
                value: 'orders:read',
                description: null,
                required: false,
                tokenClaimName: null,
                includeInAccessToken: true,
                includeInIdToken: false,
              },
            ],
            pagination,
          }),
        )
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(
          jsonResponse({
            permissions: [
              {
                id: 'permission-1',
                resourceId: 'resource-1',
                scopeId: null,
                key: 'orders.read',
                description: null,
                tokenClaimValue: null,
              },
            ],
            pagination,
          }),
        )
      }
      return consoleSharedFetch(input, init)
    })

    // settings tab: resource with null description/namespace and disabled -> Enable button
    const { unmount } = renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)
    expect(await screen.findByRole('button', { name: 'Enable' })).toBeTruthy()

    // scopes tab: scope row with no description falls back to "No description"
    unmount()
    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" section="scopes" />)
    expect(await screen.findByText('orders:read')).toBeTruthy()
    expect(screen.getByText('No description')).toBeTruthy()

    cleanup()
    // permissions tab: permission row falls back to its key with no description/scopeId
    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" section="permissions" />)
    expect(await screen.findByText('orders.read')).toBeTruthy()
  })

  it('retries authorization detail loading failures', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/management/roles/role-1') {
        return Promise.resolve(jsonResponse({ error: 'Role unavailable.' }, 503))
      }
      if (url === '/api/management/api-resources/resource-1') {
        return Promise.resolve(jsonResponse({ error: 'Resource unavailable.' }, 503))
      }
      if (url === '/api/management/roles/role-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [] }))
      }
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url.endsWith('/scopes')) return Promise.resolve(jsonResponse({ scopes: [], pagination: emptyPagination }))
      if (url.endsWith('/permissions')) {
        return Promise.resolve(jsonResponse({ permissions: [], pagination: emptyPagination }))
      }
      return consoleSharedFetch(input, init)
    })

    const { unmount } = renderWithQuery(<RoleDetailPage roleId="role-1" />)

    expect(await screen.findByText('Role unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(requests.filter((url) => url === '/api/management/roles/role-1').length).toBe(2))

    unmount()
    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)

    expect(await screen.findByText('Resource unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(requests.filter((url) => url === '/api/management/api-resources/resource-1').length).toBe(2),
    )
  })
})
