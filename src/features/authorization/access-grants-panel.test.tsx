import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apiResource,
  jsonResponse,
  renderWithQuery,
  unexpectedConsoleRequest,
} from '@/features/console/console.test-utils'
import { AccessGrantsPanel } from './access-grants-panel'

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
const grant: {
  id: string
  resourceServerId: string
  scopes: string[]
  status: string
  expiresAt: string | null
} = {
  id: 'grant-1',
  resourceServerId: resource.id,
  scopes: ['orders:read'],
  status: 'active',
  expiresAt: null,
}
const page = (items = [grant], offset = 0, hasMore = false) => ({
  items,
  pagination: {
    limit: 50,
    offset,
    total: hasMore || offset ? 51 : items.length,
    hasMore,
    nextOffset: hasMore ? 50 : null,
  },
})
function request(input: RequestInfo | URL, init?: RequestInit) {
  const r = input instanceof Request ? input : null
  const u = r ? new URL(r.url) : null
  return { url: u ? `${u.pathname}${u.search}` : String(input), method: r?.method ?? init?.method ?? 'GET' }
}

describe('Access grants panel', () => {
  it('renders empty and boundary-error states', async () => {
    let fail = false
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (fail) return Promise.reject(new Error('offline'))
      const { url } = request(input, init)
      if (url === '/api/resource-servers?limit=100')
        return Promise.resolve(jsonResponse({ items: [], pagination: page([]).pagination }))
      if (url.includes('/scope-grants?')) return Promise.resolve(jsonResponse(page([])))
      return unexpectedConsoleRequest(input, init)
    })
    renderWithQuery(<AccessGrantsPanel subject={{ type: 'user', id: 'empty', label: 'Nobody' }} />)
    expect(await screen.findByText('No access grants')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add access grant' })).toHaveProperty('disabled', true)
    cleanup()
    fail = true
    renderWithQuery(<AccessGrantsPanel subject={{ type: 'user', id: 'error', label: 'Nobody' }} />)
    expect(await screen.findByText('offline')).toBeTruthy()
  })

  it('creates and revokes user grants', async () => {
    let grants = [grant]
    const calls: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const { url, method } = request(input, init)
      calls.push(`${method} ${url}`)
      if (url === '/api/resource-servers?limit=100')
        return Promise.resolve(jsonResponse({ items: [resource], pagination: page([]).pagination }))
      if (url === '/api/users/user-1/scope-grants?limit=50&offset=0') return Promise.resolve(jsonResponse(page(grants)))
      if (url === '/api/users/user-1/scope-grants' && method === 'POST')
        return Promise.resolve(jsonResponse(grant, 201))
      if (url.endsWith('/scope-grants/grant-1') && method === 'DELETE') {
        grants = []
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return unexpectedConsoleRequest(input, init)
    })
    renderWithQuery(<AccessGrantsPanel subject={{ type: 'user', id: 'user-1', label: 'Jane' }} />)
    await screen.findByText('Orders API')
    fireEvent.click(screen.getByRole('button', { name: 'Add access grant' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /orders:read/ }))
    fireEvent.submit(document.getElementById('create-access-grant')!)
    await waitFor(() => expect(calls).toContain('POST /api/users/user-1/scope-grants'))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Revoke access grant' }))
    expect(await screen.findByText('No access grants')).toBeTruthy()
  })

  it('uses Application endpoints and pagination', async () => {
    const calls: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const { url, method } = request(input, init)
      calls.push(`${method} ${url}`)
      if (url === '/api/resource-servers?limit=100')
        return Promise.resolve(jsonResponse({ items: [resource], pagination: page([]).pagination }))
      if (url.endsWith('offset=0')) return Promise.resolve(jsonResponse(page([grant], 0, true)))
      if (url.endsWith('offset=50')) return Promise.resolve(jsonResponse(page([grant], 50, false)))
      if (url === '/api/applications/app-1/scope-grants' && method === 'POST')
        return Promise.resolve(jsonResponse(grant, 201))
      if (url.endsWith('/grant-1') && method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }))
      return unexpectedConsoleRequest(input, init)
    })
    renderWithQuery(<AccessGrantsPanel subject={{ type: 'application', id: 'app-1', label: 'Worker' }} />)
    await screen.findByText('Orders API')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Previous' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Previous' })).toHaveProperty('disabled', true))
    fireEvent.click(screen.getByRole('button', { name: 'Add access grant' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /orders:read/ }))
    fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2099-01-01T00:00' } })
    fireEvent.submit(document.getElementById('create-access-grant')!)
    await waitFor(() => expect(calls).toContain('POST /api/applications/app-1/scope-grants'))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Revoke access grant' }))
    await waitFor(() => expect(calls).toContain('DELETE /api/applications/app-1/scope-grants/grant-1'))
  })

  it('renders boundary values and closes grant dialogs without mutating', async () => {
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
    const expiringGrant = {
      ...grant,
      resourceServerId: 'missing-resource',
      status: 'expired',
      expiresAt: '2027-01-01T00:00:00.000Z',
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const { url } = request(input, init)
      if (url === '/api/resource-servers?limit=100') {
        return Promise.resolve(
          jsonResponse({ items: [resource, secondResource, unregisteredResource], pagination: page([]).pagination }),
        )
      }
      if (url.includes('/scope-grants?')) return Promise.resolve(jsonResponse(page([expiringGrant])))
      return unexpectedConsoleRequest(input, init)
    })

    renderWithQuery(<AccessGrantsPanel subject={{ type: 'user', id: 'user-2', label: 'Alex' }} />)
    expect((await screen.findAllByText('missing-resource')).length).toBeGreaterThan(0)
    expect(screen.getByText('expired')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Add access grant' }))
    fireEvent.change(await screen.findByLabelText('Resource Server'), { target: { value: secondResource.id } })
    const scope = await screen.findByRole('checkbox', { name: /invoices:read/ })
    fireEvent.click(scope)
    fireEvent.click(scope)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /invoices:read/ })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('treats omitted collection fields as empty boundary responses', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const { url } = request(input, init)
      if (url === '/api/resource-servers?limit=100' || url.includes('/scope-grants?')) {
        return Promise.resolve(jsonResponse({}))
      }
      return unexpectedConsoleRequest(input, init)
    })
    renderWithQuery(<AccessGrantsPanel subject={{ type: 'user', id: 'sparse', label: 'Sparse' }} />)
    expect(await screen.findByText('No access grants')).toBeTruthy()
  })

  it('returns to the previous page after revoking its final grant', async () => {
    let finishDelete: ((response: Response) => void) | undefined
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const { url, method } = request(input, init)
      if (url === '/api/resource-servers?limit=100') {
        return Promise.resolve(jsonResponse({ items: [resource], pagination: page([]).pagination }))
      }
      if (url.endsWith('offset=0')) return Promise.resolve(jsonResponse(page([grant], 0, true)))
      if (url.endsWith('offset=50')) return Promise.resolve(jsonResponse(page([grant], 50, false)))
      if (url.endsWith('/grant-1') && method === 'DELETE') {
        return new Promise<Response>((resolve) => {
          finishDelete = resolve
        })
      }
      return unexpectedConsoleRequest(input, init)
    })

    renderWithQuery(<AccessGrantsPanel subject={{ type: 'application', id: 'paged', label: 'Paged' }} />)
    await screen.findByText('Orders API')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Previous' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Revoke access grant' }))
    expect(await screen.findByRole('button', { name: 'Revoking…' })).toBeTruthy()
    finishDelete!(new Response(null, { status: 204 }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Previous' })).toHaveProperty('disabled', true))
  })
})
