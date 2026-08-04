import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebhooksPage } from '@/features/console/extracted/deployment-misc/webhooks'
import { ConsoleScopeProvider } from '@/lib/console-context'
import { queryClient } from '@/router'
import {
  emptyPagination,
  jsonResponse,
  organization,
  pagination,
  renderWithQuery,
  webhookEndpoint,
  webhookRequest,
} from './console.test-utils'

globalThis.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null
  const url = request ? new URL(request.url) : new URL(String(input), 'https://realmroot.test')
  return {
    body: request?.body ? request.clone().json() : Promise.resolve(init?.body ? JSON.parse(String(init.body)) : null),
    method: request?.method ?? init?.method ?? 'GET',
    path: `${url.pathname}${url.search}`,
  }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  queryClient.setDefaultOptions({})
  vi.restoreAllMocks()
})

describe('webhook endpoint and delivery operations', () => {
  it('creates, edits, toggles, rotates, and deletes an endpoint from the inventory', async () => {
    const mutations: Array<{ body: unknown; method: string; path: string }> = []
    const nameOnlyOrganization = { ...organization, id: 'org-2', displayName: null, name: 'Northwind' }
    const endpointRows = [
      webhookEndpoint,
      {
        ...webhookEndpoint,
        id: 'wh_2',
        url: 'https://hooks.example.com/organization',
        organizationId: 'org-2',
        enabled: false,
      },
      {
        ...webhookEndpoint,
        id: 'wh_3',
        url: 'https://hooks.example.com/unknown-organization',
        organizationId: 'org-missing',
      },
    ]
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestDetails(input, init)
      if (request.path === '/api/organizations') {
        return jsonResponse({ organizations: [organization, nameOnlyOrganization], pagination })
      }
      if (request.path.startsWith('/api/webhooks') && request.method === 'GET') {
        return jsonResponse({ endpoints: endpointRows, pagination })
      }
      if (request.path === '/api/webhooks' && request.method === 'POST') {
        mutations.push({ ...request, body: await request.body })
        return jsonResponse({ ...webhookEndpoint, signingSecret: 'whsec_created' }, 201)
      }
      if (request.path === '/api/webhooks/wh_1' && request.method === 'PATCH') {
        mutations.push({ ...request, body: await request.body })
        return jsonResponse(webhookEndpoint)
      }
      if (request.path === '/api/webhooks/wh_1/secrets' && request.method === 'POST') {
        mutations.push({ ...request, body: await request.body })
        return jsonResponse({ signingSecret: 'whsec_rotated' }, 201)
      }
      if (request.path === '/api/webhooks/wh_1' && request.method === 'DELETE') {
        mutations.push({ ...request, body: await request.body })
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`)
    })

    renderWithQuery(<WebhooksPage />)
    expect(await screen.findByText(webhookEndpoint.url)).toBeTruthy()
    const listPanel = screen.getByRole('table').closest('.consoleDataTablePanel')
    expect(listPanel).toBeTruthy()
    expect(screen.getByLabelText('Search webhooks').closest('.consoleDataTablePanel')).toBe(listPanel)
    expect(screen.getByRole('navigation', { name: 'Webhook sections' }).closest('.consoleDataTablePanel')).toBeNull()
    expect(screen.getAllByText('Northwind').length).toBeGreaterThan(0)
    expect(screen.getByText('org-missing')).toBeTruthy()
    fireEvent.pointerDown(screen.getByLabelText('Actions for https://hooks.example.com/organization'), {
      button: 0,
      ctrlKey: false,
    })
    expect(await screen.findByText('Enable')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.change(screen.getByLabelText('Search webhooks'), { target: { value: 'user.created' } })
    fireEvent.change(await screen.findByLabelText('Filter webhook status'), { target: { value: 'enabled' } })
    fireEvent.change(await screen.findByLabelText('Filter webhook scope'), { target: { value: 'org-1' } })
    await screen.findByText(webhookEndpoint.url)

    fireEvent.click(screen.getByRole('button', { name: 'Create endpoint' }))
    fireEvent.change(await screen.findByLabelText('Endpoint URL'), {
      target: { value: 'https://hooks.example.com/realmroot' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Event scope' }), { target: { value: 'org-1' } })
    fireEvent.click(screen.getByLabelText('user.created'))
    expect(screen.getByRole('button', { name: 'Create endpoint' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByLabelText('user.updated'))
    fireEvent.click(screen.getByRole('button', { name: 'Create endpoint' }))
    expect(await screen.findByRole('heading', { name: 'Signing secret' })).toBeTruthy()
    expect(screen.getByText('whsec_created')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    const openActions = async () => {
      fireEvent.pointerDown(screen.getByLabelText(`Actions for ${webhookEndpoint.url}`), {
        button: 0,
        ctrlKey: false,
      })
      await screen.findByRole('menu')
    }

    await openActions()
    fireEvent.click(screen.getByText('Edit endpoint'))
    fireEvent.change(await screen.findByLabelText('Endpoint URL'), {
      target: { value: 'https://hooks.example.com/updated' },
    })
    fireEvent.click(screen.getByLabelText('session.revoked'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit webhook endpoint' })).toBeNull())

    await openActions()
    fireEvent.click(screen.getByText('Disable'))
    await waitFor(() => expect(mutations.some((item) => item.method === 'PATCH')).toBe(true))

    await openActions()
    fireEvent.click(screen.getByText('Rotate secret'))
    expect(await screen.findByText('whsec_rotated')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    await openActions()
    fireEvent.click(screen.getByText('Delete endpoint'))
    const confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete endpoint' }))
    await waitFor(() => expect(mutations.some((item) => item.method === 'DELETE')).toBe(true))

    expect(mutations.map(({ method }) => method)).toEqual(['POST', 'PATCH', 'PATCH', 'POST', 'DELETE'])
  })

  it('reviews and retries requests, including delivered and pending response variants', async () => {
    const retries: unknown[] = []
    const requests = [
      webhookRequest,
      {
        ...webhookRequest,
        id: 'whr_2',
        organizationId: 'org-1',
        status: 'delivered',
        event: 'organization.updated',
        httpStatus: 204,
        error: null,
        requestBody: null,
        responseBody: null,
      },
      {
        ...webhookRequest,
        id: 'whr_3',
        organizationId: 'missing-org',
        status: 'pending',
        event: 'agent.created',
        httpStatus: null,
        error: null,
        requestBody: null,
        responseBody: null,
      },
    ]
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestDetails(input, init)
      if (request.path === '/api/organizations') return jsonResponse({ organizations: [organization], pagination })
      if (request.path.startsWith('/api/webhooks?')) {
        return jsonResponse({ endpoints: [webhookEndpoint], pagination: { ...pagination, total: 1 } })
      }
      if (request.path.startsWith('/api/webhooks/wh_1/deliveries') && request.method === 'GET') {
        return jsonResponse({ requests, pagination: { ...pagination, total: requests.length } })
      }
      if (request.path === '/api/webhooks/wh_1/deliveries/whr_1/attempts' && request.method === 'POST') {
        retries.push(await request.body)
        return jsonResponse({ request: webhookRequest }, 201)
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`)
    })

    renderWithQuery(<WebhooksPage section="requests" />)
    expect(await screen.findByText('user.created')).toBeTruthy()
    expect(screen.getAllByText('Acme Inc.')).toHaveLength(1)
    expect(screen.getByText('missing-org')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search webhooks'), { target: { value: 'agent' } })
    fireEvent.change(await screen.findByLabelText('Filter webhook status'), { target: { value: 'failed' } })
    fireEvent.change(await screen.findByLabelText('Filter webhook scope'), { target: { value: 'org-1' } })
    await screen.findByText('user.created')

    fireEvent.click(screen.getByText('user.created'))
    expect(await screen.findByRole('heading', { name: 'Webhook request' })).toBeTruthy()
    expect(screen.getByText('Server error')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]!)
    await waitFor(() => expect(retries).toHaveLength(1))
    expect(screen.getAllByRole('button', { name: 'Retry' })[1]).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByText('agent.created'))
    expect(within(await screen.findByRole('dialog')).getByText('Pending')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!)
  })

  it('uses the fixed Organization scope and renders empty and failed collections', async () => {
    let fail = false
    let failRequests = false
    const nameOnlyOrganization = { ...organization, id: 'org-2', displayName: null, name: 'Northwind' }
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestDetails(input, init)
      if (request.path === '/api/organizations') {
        return jsonResponse({ organizations: [organization, nameOnlyOrganization], pagination })
      }
      if (request.path.startsWith('/api/webhooks/wh_1/deliveries')) {
        return jsonResponse({ error: 'Webhook requests unavailable.' }, 500)
      }
      if (request.path.startsWith('/api/webhooks')) {
        if (fail) return jsonResponse({ error: 'Webhook inventory unavailable.' }, 500)
        const endpoints = failRequests ? [webhookEndpoint] : []
        return jsonResponse({ endpoints, pagination: { ...emptyPagination, total: endpoints.length } })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`)
    })

    const { unmount } = renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: 'org-2', realmOperator: false }}>
        <WebhooksPage />
      </ConsoleScopeProvider>,
    )
    expect(await screen.findByText('No webhook endpoints')).toBeTruthy()
    expect(screen.queryByLabelText('Filter webhook scope')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create endpoint' }))
    expect(await screen.findByText('Northwind')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    unmount()

    queryClient.clear()
    const missing = renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: 'org-missing', realmOperator: false }}>
        <WebhooksPage />
      </ConsoleScopeProvider>,
    )
    expect(await screen.findByText('No webhook endpoints')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create endpoint' }))
    expect(await screen.findByText('org-missing')).toBeTruthy()
    missing.unmount()

    fail = true
    queryClient.clear()
    const failedEndpoints = renderWithQuery(<WebhooksPage />)
    expect(await screen.findByText('Webhook inventory unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    failedEndpoints.unmount()

    fail = false
    failRequests = true
    queryClient.clear()
    renderWithQuery(<WebhooksPage section="requests" />)
    expect(await screen.findByText('Webhook requests unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  })
})
