import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
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

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to: string }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}))

const store = createAccountStore()
const server = createAccountServer(store)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
})
afterAll(() => server.close())

describe('Account Organization detail', () => {
  it('switches the active Organization without implying Console access [spec: account-center/account-organization-management]', async () => {
    store.activeOrganizationId = null
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
        ]),
      ),
      http.post(`${base}/api/auth/organization/set-active`, async ({ request }) => {
        const body = (await request.json()) as { organizationId: string | null }
        selectedOrganizationId = body.organizationId
        store.activeOrganizationId = body.organizationId
        return json({ id: body.organizationId, name: 'Family', slug: 'family' })
      }),
    )

    renderWithClient(<AccountOrganizationsPage />)

    fireEvent.click((await screen.findAllByRole('button', { name: 'Switch' }))[0])
    await waitFor(() => expect(selectedOrganizationId).toBe('org-family'))
    expect((await screen.findAllByText('Current')).length).toBe(1)
    expect(screen.queryByRole('link', { name: 'Open Console' })).toBeNull()
  })

  it('shows live Organization authority without implying Console access [spec: account-center/consumer-organization-boundary]', async () => {
    server.use(
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
      http.get(`${base}/api/account/organizations/org-family/agents`, () =>
        json({
          items: [
            {
              id: 'agent-family',
              issuer: 'https://identity.example.com/api/auth',
              subject: 'agent-family-subject',
              name: 'Family assistant',
              homeSpace: { type: 'organization', organizationId: 'org-family' },
              status: 'active',
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
            },
          ],
          pagination: { limit: 50, offset: 0, total: 1, hasMore: false, nextOffset: null },
        }),
      ),
      http.get(`${base}/api/organizations/org-family/roles`, () =>
        json({
          roles: ['owner', 'admin', 'developer', 'member'].map((key) => ({ key, displayName: key, predefined: true })),
          pagination: { limit: 100, offset: 0, total: 4, hasMore: false, nextOffset: null },
        }),
      ),
    )

    renderWithClient(<AccountOrganizationDetailPage organizationId="org-family" />)

    expect(await screen.findByRole('heading', { name: 'Family' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open Console' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeTruthy()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Members' }), { button: 0, ctrlKey: false })
    expect((await screen.findAllByText(store.profile.email)).length).toBeGreaterThan(1)
    expect(screen.queryByRole('button', { name: 'Invite member' })).toBeNull()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Agents' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('Family assistant')).toBeTruthy()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Roles' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('Your Organization Roles')).toBeTruthy()
    expect(screen.getByText('Assigned Roles')).toBeTruthy()
  })
})
