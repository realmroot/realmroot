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
        roles: [dynamicRole],
        pagination: { limit: 50, offset: 0, total: 1, hasMore: false, nextOffset: null },
      })
    })

    renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: 'org-1', realmOperator: false }}>
        <RolesPage />
      </ConsoleScopeProvider>,
    )
    expect(await screen.findByText('Operator')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'reviewer' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Reviewer' } })
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
            description: null,
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
  })
})
