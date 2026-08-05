import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsoleScopeProvider } from '@/lib/console-context'
import { jsonResponse, renderWithQuery } from './console.test-utils'
import { RoleDetailPage, RolesPage } from './extracted/roles'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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
  it('requires Organization context', async () => {
    renderWithQuery(<RolesPage />)
    expect(await screen.findByText(/Roles exist only inside an Organization/)).toBeTruthy()
  })

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

    renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: 'org-1', realmOperator: false }}>
        <RolesPage />
      </ConsoleScopeProvider>,
    )
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
    renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: 'org-1', realmOperator: false }}>
        <RoleDetailPage roleId="admin" section="permissions" />
      </ConsoleScopeProvider>,
    )
    expect(await screen.findByText('projects:read')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    cleanup()
    vi.spyOn(window, 'fetch').mockImplementation(() =>
      Promise.resolve(jsonResponse({ ...dynamicRole, key: 'admin', displayName: 'Admin', predefined: true })),
    )
    renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: 'org-1', realmOperator: false }}>
        <RoleDetailPage roleId="admin" />
      </ConsoleScopeProvider>,
    )
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

    const { router } = renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: 'org-1', realmOperator: false }}>
        <RoleDetailPage roleId="operator" />
      </ConsoleScopeProvider>,
    )
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
    await waitFor(() => expect(router.state.location.pathname).toBe('/console/roles'))
  })

  it('renders dynamic Role empty fields, empty scopes, and missing Organization context', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ ...dynamicRole, description: null, scopes: [], createdAt: null, updatedAt: null }),
      ),
    )
    const overview = renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: 'org-1', realmOperator: false }}>
        <RoleDetailPage roleId="operator" />
      </ConsoleScopeProvider>,
    )
    expect(await screen.findByText('Organization Role')).toBeTruthy()
    expect(screen.getAllByText('—')).toHaveLength(2)
    overview.unmount()
    renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: 'org-1', realmOperator: false }}>
        <RoleDetailPage roleId="operator" section="permissions" />
      </ConsoleScopeProvider>,
    )
    expect(await screen.findByText('No scopes')).toBeTruthy()
    cleanup()
    renderWithQuery(<RoleDetailPage roleId="operator" />)
    expect(await screen.findByText('Organization context is required.')).toBeTruthy()
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
    renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: 'org-1', realmOperator: false }}>
        <RoleDetailPage roleId="operator" />
      </ConsoleScopeProvider>,
    )
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
    const missing = renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: 'org-1', realmOperator: false }}>
        <RoleDetailPage roleId="missing" />
      </ConsoleScopeProvider>,
    )
    expect(await screen.findByText('Role was not found.')).toBeTruthy()
    missing.unmount()

    vi.spyOn(window, 'fetch').mockImplementation(() =>
      Promise.resolve(jsonResponse({ message: 'Role unavailable.' }, 503)),
    )
    renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: 'org-1', realmOperator: false }}>
        <RoleDetailPage roleId="missing" />
      </ConsoleScopeProvider>,
    )
    expect(await screen.findByText('Role unavailable.')).toBeTruthy()
  })
})
