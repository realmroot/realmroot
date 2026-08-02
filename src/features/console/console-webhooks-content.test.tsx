import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiResourcesPage } from '@/features/console/extracted/api-resources'
import { OrganizationDetailPage, OrganizationsPage } from '@/features/console/extracted/organizations'
import { RolesPage } from '@/features/console/extracted/roles'
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
  user,
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
  it('creates Organizations, global Roles, and Resource servers from secondary dialogs [spec: admin-console/admin-create-organization] [spec: admin-console/admin-create-role] [spec: admin-console/admin-create-api-resource]', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input).split('?')[0]
      if (['/api/organizations', '/api/roles', '/api/api-resources'].includes(url) && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        if (url === '/api/organizations') return Promise.resolve(jsonResponse(organization, 201))
        if (url === '/api/roles') return Promise.resolve(jsonResponse(role, 201))
        return Promise.resolve(jsonResponse(apiResource, 201))
      }
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
      }
      if (url === '/api/organizations/org-1/members') {
        return Promise.resolve(jsonResponse({ members: [], pagination: emptyPagination }))
      }
      if (url === '/api/roles') return Promise.resolve(jsonResponse({ roles: [role], pagination }))
      if (url === '/api/roles/role-1/permissions') {
        return Promise.resolve(jsonResponse({ roleId: 'role-1', permissions: [] }))
      }
      if (url === '/api/api-resources') {
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
    renderWithQuery(<RolesPage />)
    expect(await screen.findByText('Admin')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    fireEvent.change(await screen.findByLabelText('Key'), { target: { value: 'auditor' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Auditor' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Reads audit events' } })
    expect(screen.queryByLabelText('Permissions')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(requests).toHaveLength(2))

    unmount()
    renderWithQuery(<ApiResourcesPage />)
    expect(await screen.findByText('Management API')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New resource server' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Billing API' } })
    fireEvent.change(screen.getByLabelText('Identifier'), { target: { value: 'billing-api' } })
    fireEvent.change(screen.getByLabelText('Protected resource URL'), {
      target: { value: 'https://billing.example.com' },
    })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Billing resource' } })
    expect(screen.getByLabelText('Authorization model')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Access eligibility')).toHaveProperty('value', 'realm')
    expect(screen.getByRole('switch', { name: 'Available to Agents' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(requests).toEqual([
        { url: '/api/organizations', body: { slug: 'northwind', name: 'Northwind Traders' } },
        { url: '/api/roles', body: { key: 'auditor', name: 'Auditor', description: 'Reads audit events' } },
        {
          url: '/api/api-resources',
          body: {
            identifier: 'billing-api',
            name: 'Billing API',
            resourceUrl: 'https://billing.example.com',
            authorizationDetails: [],
            description: 'Billing resource',
            ownerOrganizationId: 'org-1',
            accessEligibility: { mode: 'realm', organizationIds: [] },
            availableToAgents: true,
          },
        },
      ]),
    )
  })

  it('renders a compact Organization overview and edits identity from Settings', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    let deleted = false
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const raw = String(input)
      const url = raw.startsWith('http') ? new URL(raw).pathname : raw.split('?')[0]
      if (url === '/api/organizations/org-1' && init?.method === 'DELETE') {
        deleted = true
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/organizations/org-1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        requests.push({ url, body })
        return Promise.resolve(jsonResponse({ ...organization, ...body }))
      }
      if (deleted && url.startsWith('/api/organizations/org-1')) {
        throw new Error(`Removed Organization detail was refetched: ${init?.method ?? 'GET'} ${raw}`)
      }
      if (url === '/api/organizations/org-1') return Promise.resolve(jsonResponse(organization))
      if (url === '/api/organizations/org-1/members') {
        return Promise.resolve(
          jsonResponse({
            members: [
              {
                id: 'member-owner',
                organizationId: 'org-1',
                userId: user.id,
                role: 'owner',
                title: null,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
            pagination: { ...emptyPagination, total: 1 },
          }),
        )
      }
      if (url === '/api/organizations/org-1/invitations') {
        return Promise.resolve(
          jsonResponse({
            invitations: [
              {
                id: 'invitation-canceled',
                organizationId: 'org-1',
                email: 'canceled@example.com',
                role: 'member',
                inviterId: 'user-1',
                status: 'canceled',
                expiresAt: '2026-01-08T00:00:00.000Z',
                acceptedAt: null,
                revokedAt: null,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
            pagination: { ...emptyPagination, total: 1 },
          }),
        )
      }
      if (url === '/api/users') return Promise.resolve(jsonResponse({ users: [user], pagination }))
      if (url === '/api/agents') return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      if (url === '/api/audit-events') return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${raw}`)
    })

    renderWithQuery(<OrganizationDetailPage organizationId="org-1" />)
    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeTruthy()
    expect(screen.getByText(/org-1/)).toBeTruthy()
    expect(screen.getAllByText('Members').length).toBeGreaterThan(0)
    expect(screen.getByText('Pending invitations')).toBeTruthy()
    expect(screen.getByText('Pending invitations').closest('.detailFlatRow')?.textContent).toContain('0')
    expect(screen.getByText('Agent identities')).toBeTruthy()
    expect(screen.queryByText('Applications & resource servers')).toBeNull()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Members' }), { button: 0, ctrlKey: false })
    expect(screen.queryByText('canceled@example.com')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Manage Jane Doe' })).toBeNull()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Settings' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Acme Updated' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'acme-updated' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          url: '/api/organizations/org-1',
          body: { name: 'Acme Updated', slug: 'acme-updated' },
        },
      ]),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete organization' }))
    await waitFor(() => expect(deleted).toBe(true))
  })
})
