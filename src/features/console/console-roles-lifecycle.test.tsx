import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoleDetailPage, RolesPage } from '@/features/roles/management-roles'
import { jsonResponse, renderWithQuery } from './console.test-utils'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

const dynamicRole = {
  key: 'operator',
  displayName: 'Operator',
  description: 'Operates projects.',
  predefined: false,
  scopes: [{ resourceId: 'resource-1', scope: 'projects:read' }],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

describe('Organization Role lifecycle', () => {
  it('lists Organization Roles and creates a dynamic Role', async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString(),
        window.location.origin,
      )
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body))
        requests.push({ method, path: url.pathname, body })
        return jsonResponse({ ...dynamicRole, ...body }, 201)
      }
      return jsonResponse({
        roles: [
          dynamicRole,
          { ...dynamicRole, key: 'member', displayName: 'Member', description: null, predefined: true },
        ],
        pagination: { limit: 50, offset: 0, total: 2, hasMore: false, nextOffset: null },
      })
    })

    renderWithQuery(<RolesPage organizationId="org-1" />)
    expect(await screen.findByText('Operator')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Create Role' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'reviewer' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Reviewer' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Reviews projects.' } })
    fireEvent.change(screen.getByLabelText('Scopes'), { target: { value: 'resource-1 projects:read' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          method: 'POST',
          path: '/api/organizations/org-1/roles',
          body: {
            key: 'reviewer',
            displayName: 'Reviewer',
            description: 'Reviews projects.',
            scopes: [{ resourceId: 'resource-1', scope: 'projects:read' }],
          },
        },
      ]),
    )
  })

  it('renders scopes and keeps predefined Roles immutable', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse({ ...dynamicRole, key: 'admin', displayName: 'Admin', predefined: true }),
    )
    renderWithQuery(<RoleDetailPage organizationId="org-1" roleId="admin" section="permissions" />)
    expect(await screen.findByText('projects:read')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    cleanup()
    vi.spyOn(window, 'fetch').mockImplementation(() =>
      Promise.resolve(jsonResponse({ ...dynamicRole, key: 'admin', displayName: 'Admin', predefined: true })),
    )
    renderWithQuery(<RoleDetailPage organizationId="org-1" roleId="admin" section="settings" />)
    expect(await screen.findByText('Predefined')).toBeTruthy()
  })

  it('edits and deletes a dynamic Role from its detail page', async () => {
    const requests: Array<{ method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : null
      const method = init?.method ?? request?.method ?? 'GET'
      if (method === 'PATCH') {
        const body = JSON.parse(String(init?.body ?? (await request?.text())))
        requests.push({ method, body })
        return jsonResponse({ ...dynamicRole, ...body })
      }
      if (method === 'DELETE') {
        requests.push({ method, body: null })
        return new Response(null, { status: 204 })
      }
      return jsonResponse(dynamicRole)
    })

    const { router } = renderWithQuery(<RoleDetailPage organizationId="org-1" roleId="operator" />)
    expect(await screen.findByText('Operates projects.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Tenant operator' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Scopes'), {
      target: { value: 'resource-2 projects:write\nresource-1 projects:read' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(requests[0]).toEqual({
        method: 'PATCH',
        body: {
          displayName: 'Tenant operator',
          description: null,
          scopes: [
            { resourceId: 'resource-2', scope: 'projects:write' },
            { resourceId: 'resource-1', scope: 'projects:read' },
          ],
        },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Role' }))
    await waitFor(() => expect(requests.at(-1)).toEqual({ method: 'DELETE', body: null }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/organizations/org-1/roles'))
  })

  it('renders dynamic Role empty fields, empty scopes, and empty scopes', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ ...dynamicRole, description: null, scopes: [], createdAt: null, updatedAt: null }),
      ),
    )
    const overview = renderWithQuery(<RoleDetailPage organizationId="org-1" roleId="operator" />)
    expect(await screen.findByText('Organization Role')).toBeTruthy()
    expect(screen.getAllByText('—')).toHaveLength(2)
    overview.unmount()
    renderWithQuery(<RoleDetailPage organizationId="org-1" roleId="operator" section="permissions" />)
    expect(await screen.findByText('No scopes')).toBeTruthy()
  })

  it('keeps failed dynamic Role mutations open with actionable errors', async () => {
    const methods: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : null
      const method = init?.method ?? request?.method ?? 'GET'
      methods.push(method)
      if (method === 'DELETE') throw new Error('Role delete failed.')
      if (method !== 'GET') return jsonResponse({ message: 'Role change failed.' }, 409)
      return jsonResponse(dynamicRole)
    })
    renderWithQuery(<RoleDetailPage organizationId="org-1" roleId="operator" />)
    expect(await screen.findByText('Operates projects.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(methods).toContain('PATCH'))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Request failed.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Role' }))
    await waitFor(() => expect(methods).toContain('DELETE'))
    expect(await screen.findByText('Role delete failed.')).toBeTruthy()
  })

  it('renders missing and failed Role detail reads', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(() => Promise.resolve(jsonResponse(null)))
    const missing = renderWithQuery(<RoleDetailPage organizationId="org-1" roleId="missing" />)
    expect(await screen.findByText('Role was not found.')).toBeTruthy()
    missing.unmount()

    vi.spyOn(window, 'fetch').mockImplementation(() =>
      Promise.resolve(jsonResponse({ message: 'Role unavailable.' }, 503)),
    )
    renderWithQuery(<RoleDetailPage organizationId="org-1" roleId="missing" />)
    expect(await screen.findByText('Role unavailable.')).toBeTruthy()
  })

  it('retries failed Role lists and navigates between detail sections', async () => {
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ message: 'Roles unavailable.' }, 503))
      .mockResolvedValueOnce(
        jsonResponse({
          roles: [],
          pagination: { limit: 50, offset: 0, total: 0, hasMore: false, nextOffset: null },
        }),
      )

    const list = renderWithQuery(<RolesPage organizationId="org-1" />)
    expect(await screen.findByText('Roles unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No Roles')).toBeTruthy()
    list.unmount()

    fetch.mockResolvedValueOnce(jsonResponse(dynamicRole))
    const { router } = renderWithQuery(<RoleDetailPage organizationId="org-1" roleId="operator" />)
    expect(await screen.findByText('Operates projects.')).toBeTruthy()
    window.history.pushState(null, '', '/organizations/org-1/roles/operator/overview')
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Permissions' }), { button: 0, ctrlKey: false })
    await waitFor(() => expect(router.state.location.pathname).toBe('/organizations/org-1/roles/operator/permissions'))
  })
})
