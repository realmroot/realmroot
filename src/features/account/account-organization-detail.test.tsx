import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  base,
  createAccountServer,
  createAccountStore,
  http,
  json,
  renderWithClient,
} from '@/features/account/account.test-utils'
import { AccountOrganizationDetailPage, AccountOrganizationsPage } from '@/features/account/planned-pages'

const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
    to,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode
    params?: Record<string, string>
    to: string
  }) => {
    const href = Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)
    return (
      <a {...props} href={href}>
        {children}
      </a>
    )
  },
  useNavigate: () => navigate,
}))

const store = createAccountStore()
const server = createAccountServer(store)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  navigate.mockReset()
})
afterAll(() => server.close())

describe('Account Organization detail', () => {
  it('opens Organizations without a separate Current or Switch action [spec: account-center/account-organization-management]', async () => {
    server.use(
      http.get(`${base}/api/auth/organization/list`, () =>
        json([
          {
            id: 'org-family',
            name: 'Family',
            slug: 'family',
            createdAt: '2026-08-01T00:00:00.000Z',
          },
        ]),
      ),
    )

    renderWithClient(<AccountOrganizationsPage />)

    expect(await screen.findByRole('link', { name: 'Manage' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Switch' })).toBeNull()
    expect(screen.queryByText('Current')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open Console' })).toBeNull()
  })

  it('shows live Organization authority without implying Console access [spec: account-center/consumer-organization-boundary]', async () => {
    let selectedOrganizationId: string | null = null
    server.use(
      http.get(`${base}/api/auth/organization/list`, () =>
        json([
          {
            id: 'org-family',
            name: 'Family',
            slug: 'family',
            createdAt: '2026-08-01T00:00:00.000Z',
          },
          {
            id: 'org-studio',
            name: 'Studio',
            slug: 'studio',
            createdAt: '2026-08-02T00:00:00.000Z',
          },
        ]),
      ),
      http.get(`${base}/api/auth/organization/get-full-organization`, () =>
        json({
          id: 'org-family',
          name: 'Family',
          slug: 'family',
          createdAt: '2026-08-01T00:00:00.000Z',
          members: [
            {
              id: 'member-1',
              userId: store.profile.id,
              role: 'member',
              user: { id: store.profile.id, name: store.profile.displayName, email: store.profile.email },
              createdAt: '2026-08-01T00:00:00.000Z',
            },
          ],
          invitations: [],
        }),
      ),
      http.post(`${base}/api/auth/organization/set-active`, async ({ request }) => {
        const body = (await request.json()) as { organizationId: string | null }
        selectedOrganizationId = body.organizationId
        return json({ id: body.organizationId, name: 'Studio', slug: 'studio' })
      }),
      http.get(`${base}/api/organizations/org-family/roles`, () =>
        json({
          items: ['owner', 'admin', 'developer', 'member'].map((key) => ({ key, displayName: key, predefined: true })),
          pagination: { page: Math.floor(0 / 100) + 1, pageSize: 100, totalItems: 4, totalPages: Math.ceil(4 / 100) },
        }),
      ),
    )

    renderWithClient(<AccountOrganizationDetailPage organizationId="org-family" />, {
      organizationId: 'org-family',
      pathname: '/organizations/org-family/overview',
    })

    expect(await screen.findByRole('heading', { name: 'Family' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open Console' })).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Organization workspace' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Applications' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Resource servers' })).toBeTruthy()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Switch organization' }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Studio/ }))
    await waitFor(() => expect(selectedOrganizationId).toBe('org-studio'))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        params: { organizationId: 'org-studio' },
        to: '/organizations/$organizationId/overview',
      }),
    )

    cleanup()
    renderWithClient(<AccountOrganizationDetailPage organizationId="org-family" section="members" />)
    expect((await screen.findAllByText(store.profile.email)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Invite member' })).toBeNull()

    cleanup()
    renderWithClient(<AccountOrganizationDetailPage organizationId="org-family" section="roles" />)
    expect(await screen.findByText('Your Organization Roles')).toBeTruthy()
    expect(screen.getByText('Assigned Roles')).toBeTruthy()
  })

  it('keeps the current Workspace when Organization switching fails', async () => {
    let switchRequests = 0
    server.use(
      http.get(`${base}/api/auth/organization/list`, () =>
        json([
          { id: 'org-family', name: 'Family', slug: 'family', createdAt: '2026-08-01T00:00:00.000Z' },
          { id: 'org-studio', name: 'Studio', slug: 'studio', createdAt: '2026-08-02T00:00:00.000Z' },
        ]),
      ),
      http.post(`${base}/api/auth/organization/set-active`, () => {
        switchRequests += 1
        return json({ message: 'Organization switch failed.' }, { status: 500 })
      }),
    )

    renderWithClient(<p>Workspace content</p>, {
      organizationId: 'org-family',
      pathname: '/organizations/org-family/overview',
    })
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Switch organization' }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Studio/ }))

    await waitFor(() => expect(switchRequests).toBe(1))
    expect(navigate).not.toHaveBeenCalled()
  })

  it('surfaces Organization collection failures from Workspace navigation', async () => {
    server.use(
      http.get(`${base}/api/auth/organization/list`, () =>
        json({ message: 'Organizations unavailable.' }, { status: 503 }),
      ),
    )

    renderWithClient(<p>Workspace content</p>, {
      organizationId: 'org-missing',
      pathname: '/organizations/org-missing/overview',
    })
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Switch organization' }), {
      button: 0,
      ctrlKey: false,
    })

    expect((await screen.findByRole('alert')).textContent).toContain('Organizations unavailable.')
  })
})
