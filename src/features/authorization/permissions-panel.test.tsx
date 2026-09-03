import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apiResource,
  jsonResponse,
  renderWithQuery,
  unexpectedConsoleRequest,
} from '@/features/console/console.test-utils'
import { PermissionsPanel } from './permissions-panel'

globalThis.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
const resource = {
  ...apiResource,
  id: 'resource-1',
  name: 'Orders API',
  identifier: 'orders',
  scopeRegistry: {
    discovery: {
      sourceUrl: 'https://api.example/meta',
      etag: null,
      documentHash: 'x',
      syncedAt: '2026-08-06T00:00:00.000Z',
      lastError: null,
    },
    scopes: [{ value: 'orders:read', description: 'Read orders', grantMode: 'assigned' as const }],
  },
}
const entitlement: {
  id: string
  resourceServerId: string
  scope: string
  mode: 'persistent'
  status: string
  expiresAt: string | null
} = {
  id: 'ent_1',
  resourceServerId: resource.id,
  scope: 'orders:read',
  mode: 'persistent',
  status: 'active',
  expiresAt: null,
}
const page = (items = [entitlement], currentPage = 1, totalItems = items.length) => ({
  items,
  pagination: {
    page: currentPage,
    pageSize: 50,
    totalItems,
    totalPages: Math.ceil(totalItems / 50),
  },
})
function request(input: RequestInfo | URL, init?: RequestInit) {
  const r = input instanceof Request ? input : null
  const u = r ? new URL(r.url) : null
  return { url: u ? `${u.pathname}${u.search}` : String(input), method: r?.method ?? init?.method ?? 'GET' }
}

describe('Scope Permissions panel', () => {
  it('renders empty and boundary-error states', async () => {
    let fail = false
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (fail) return Promise.reject(new Error('offline'))
      const { url } = request(input, init)
      if (url === '/api/resource-servers?page=1&pageSize=100')
        return Promise.resolve(jsonResponse({ items: [], pagination: page([]).pagination }))
      if (url.includes('/permissions?')) return Promise.resolve(jsonResponse(page([])))
      return unexpectedConsoleRequest(input, init)
    })
    renderWithQuery(<PermissionsPanel subject={{ type: 'user', id: 'empty', label: 'Nobody' }} />)
    expect(await screen.findByText('No Resource access')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add scope' })).toHaveProperty('disabled', true)
    cleanup()
    fail = true
    renderWithQuery(<PermissionsPanel subject={{ type: 'user', id: 'error', label: 'Nobody' }} />)
    expect(await screen.findByText('offline')).toBeTruthy()
  })

  it('creates and revokes User Permissions', async () => {
    let permissions = [entitlement]
    let finishCreate: ((response: Response) => void) | undefined
    const calls: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const { url, method } = request(input, init)
      calls.push(`${method} ${url}`)
      if (url === '/api/resource-servers?page=1&pageSize=100')
        return Promise.resolve(jsonResponse({ items: [resource], pagination: page([]).pagination }))
      if (url === '/api/users/user-1/permissions?page=1&pageSize=50')
        return Promise.resolve(jsonResponse(page(permissions)))
      if (url === '/api/users/user-1/permissions' && method === 'POST')
        return new Promise<Response>((resolve) => {
          finishCreate = resolve
        })
      if (url.endsWith('/permissions/ent_1') && method === 'DELETE') {
        permissions = []
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return unexpectedConsoleRequest(input, init)
    })
    renderWithQuery(<PermissionsPanel subject={{ type: 'user', id: 'user-1', label: 'Jane' }} />)
    await screen.findByText('Orders API')
    fireEvent.click(screen.getByRole('button', { name: 'Add scope' }))
    fireEvent.submit(document.getElementById('create-permission')!)
    expect(await screen.findByRole('button', { name: 'Adding…' })).toBeTruthy()
    finishCreate!(jsonResponse(entitlement, 201))
    await waitFor(() => expect(calls).toContain('POST /api/users/user-1/permissions'))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Revoke scope' }))
    expect(await screen.findByText('No Resource access')).toBeTruthy()
  })

  it('uses Application endpoints and pagination', async () => {
    const calls: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const { url, method } = request(input, init)
      calls.push(`${method} ${url}`)
      if (url === '/api/resource-servers?page=1&pageSize=100')
        return Promise.resolve(jsonResponse({ items: [resource], pagination: page([]).pagination }))
      if (url.endsWith('page=1&pageSize=50')) return Promise.resolve(jsonResponse(page([entitlement], 1, 51)))
      if (url.endsWith('page=2&pageSize=50')) return Promise.resolve(jsonResponse(page([entitlement], 2, 51)))
      if (url === '/api/applications/app-1/permissions' && method === 'POST')
        return Promise.resolve(jsonResponse(entitlement, 201))
      if (url.endsWith('/ent_1') && method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }))
      return unexpectedConsoleRequest(input, init)
    })
    renderWithQuery(<PermissionsPanel subject={{ type: 'application', id: 'app-1', label: 'Worker' }} />)
    await screen.findByText('Orders API')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Previous' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Previous' })).toHaveProperty('disabled', true))
    fireEvent.click(screen.getByRole('button', { name: 'Add scope' }))
    fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2099-01-01T00:00' } })
    fireEvent.submit(document.getElementById('create-permission')!)
    await waitFor(() => expect(calls).toContain('POST /api/applications/app-1/permissions'))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Revoke scope' }))
    await waitFor(() => expect(calls).toContain('DELETE /api/applications/app-1/permissions/ent_1'))
  })

  it('renders boundary values and closes Permission dialogs without mutating', async () => {
    const secondResource = {
      ...resource,
      id: 'resource-2',
      name: 'Invoices API',
      identifier: 'invoices',
      scopeRegistry: {
        ...resource.scopeRegistry,
        scopes: [{ value: 'invoices:read', description: null, grantMode: 'assigned' as const }],
      },
    }
    const unregisteredResource = { ...resource, id: 'resource-3', name: 'Automatic API', scopeRegistry: null }
    const expiringPermission = {
      ...entitlement,
      resourceServerId: 'missing-resource',
      expiresAt: '2027-01-01T00:00:00.000Z',
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const { url } = request(input, init)
      if (url === '/api/resource-servers?page=1&pageSize=100') {
        return Promise.resolve(
          jsonResponse({ items: [resource, secondResource, unregisteredResource], pagination: page([]).pagination }),
        )
      }
      if (url.includes('/permissions?')) return Promise.resolve(jsonResponse(page([expiringPermission])))
      return unexpectedConsoleRequest(input, init)
    })

    renderWithQuery(<PermissionsPanel subject={{ type: 'user', id: 'user-2', label: 'Alex' }} />)
    expect((await screen.findAllByText('missing-resource')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Add scope' }))
    fireEvent.change(await screen.findByLabelText('Resource Server'), { target: { value: secondResource.id } })
    fireEvent.change(await screen.findByLabelText('Scope'), { target: { value: 'invoices:read' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Scope')).toBeNull())
  })

  it('treats omitted collection fields as empty boundary responses', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const { url } = request(input, init)
      if (url === '/api/resource-servers?page=1&pageSize=100' || url.includes('/permissions?')) {
        return Promise.resolve(jsonResponse({}))
      }
      return unexpectedConsoleRequest(input, init)
    })
    renderWithQuery(<PermissionsPanel subject={{ type: 'user', id: 'sparse', label: 'Sparse' }} />)
    expect(await screen.findByText('No Resource access')).toBeTruthy()
  })

  it('returns to the previous page after revoking its final grant', async () => {
    let finishDelete: ((response: Response) => void) | undefined
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const { url, method } = request(input, init)
      if (url === '/api/resource-servers?page=1&pageSize=100') {
        return Promise.resolve(jsonResponse({ items: [resource], pagination: page([]).pagination }))
      }
      if (url.endsWith('page=1&pageSize=50')) return Promise.resolve(jsonResponse(page([entitlement], 1, 51)))
      if (url.endsWith('page=2&pageSize=50')) return Promise.resolve(jsonResponse(page([entitlement], 2, 51)))
      if (url.endsWith('/ent_1') && method === 'DELETE') {
        return new Promise<Response>((resolve) => {
          finishDelete = resolve
        })
      }
      return unexpectedConsoleRequest(input, init)
    })

    renderWithQuery(<PermissionsPanel subject={{ type: 'application', id: 'paged', label: 'Paged' }} />)
    await screen.findByText('Orders API')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Previous' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Revoke scope' }))
    expect(await screen.findByRole('button', { name: 'Revoking…' })).toBeTruthy()
    finishDelete!(new Response(null, { status: 204 }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Previous' })).toHaveProperty('disabled', true))
  })
})
