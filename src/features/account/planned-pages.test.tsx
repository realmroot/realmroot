import type { AccessRequestApproval } from '@shared/api/agent-api'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { delay } from 'msw'
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
import {
  AccountAgentsPage,
  AccountApplicationsPage,
  AccountOrganizationDetailPage,
  AccountOrganizationsPage,
  AccountOverviewPage,
} from '@/features/account/planned-pages'

const navigate = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to: string }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}))

const store = createAccountStore()
const server = createAccountServer(store)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  navigate.mockReset()
  store.activeOrganizationId = null
  store.access = {
    canCreateOrganization: true,
    showOrganizations: false,
    platformOperator: false,
    consoleOrganizations: [],
  }
  store.security.mfa.enabled = false
  store.security.passkeys.count = 0
  store.sessions = []
  store.applications = []
  store.agentIdentities = []
  vi.restoreAllMocks()
})
afterAll(() => server.close())

describe('planned Account Center journeys', () => {
  it('reviews overview security, sessions, invitations, and Agent access decisions', async () => {
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(9)
    store.security.mfa.enabled = true
    store.sessions = [
      {
        id: 'session-current',
        userAgent: 'Mozilla/5.0 (Mac OS X) Chrome/120',
        ipAddress: '192.0.2.10',
        expiresAt: '2099-01-01T00:00:00.000Z',
        current: true,
      },
      {
        id: 'session-other',
        userAgent: null,
        ipAddress: null,
        expiresAt: '2099-01-02T00:00:00.000Z',
        current: false,
      },
    ]
    store.applications = [
      {
        id: 'consent-1',
        applicationName: 'Project board',
        scopes: ['openid'],
        grantedAt: '2026-08-01T00:00:00.000Z',
      },
    ]
    store.agentIdentities = [agent('agent-active', 'Build Agent', 'active')]
    const requestedAuthorizationDetails = [{ type: 'project_access', project_id: 'project-1', actions: ['read'] }]
    let decision: unknown = null
    server.use(
      http.get(`${base}/api/account/access-requests`, () =>
        json({
          items: [
            { ...accessRequest(), authorizationDetail: null, authorizationDetails: requestedAuthorizationDetails },
          ],
          pagination: pagination(1),
        }),
      ),
      http.put(`${base}/api/account/access-requests/request-1/decision`, async ({ request }) => {
        decision = await request.json()
        return json({ id: 'request-1', status: 'approved' })
      }),
      http.get(`${base}/api/auth/organization/list-user-invitations`, () =>
        json([
          {
            id: 'invitation-1',
            organizationName: 'Acme',
            role: 'developer',
            status: 'pending',
            createdAt: '2026-08-01T00:00:00.000Z',
            expiresAt: '2099-08-08T00:00:00.000Z',
          },
          {
            id: 'invitation-old',
            organizationName: 'Old org',
            role: 'member',
            status: 'accepted',
            createdAt: '2026-07-01T00:00:00.000Z',
            expiresAt: '2026-07-08T00:00:00.000Z',
          },
        ]),
      ),
    )

    renderWithClient(<AccountOverviewPage />)

    expect(await screen.findByRole('heading', { name: 'Good morning, Jane.' })).toBeTruthy()
    expect(await screen.findByText('Strong')).toBeTruthy()
    expect(screen.getByText('Chrome on macOS')).toBeTruthy()
    expect(screen.getByText('Unknown device')).toBeTruthy()
    expect(screen.getByText('Acme')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Review request' }))
    expect(await screen.findByRole('heading', { name: 'Review Agent access request' })).toBeTruthy()
    expect(screen.getByText('{"type":"project_access","project_id":"project-1","actions":["read"]}')).toBeTruthy()
    closeDialogWithEscape()
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }))
    fireEvent.change(screen.getByLabelText('Access duration'), { target: { value: 'until' } })
    const expiry = screen.getByLabelText('Expiry date and time')
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(expiry, { target: { value: '2099-01-01T12:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(decision).toEqual({
        decision: 'approve',
        mode: 'until',
        authorizationDetails: requestedAuthorizationDetails,
        expiresAt: expect.any(String),
      }),
    )
  })

  it.each([
    [14, 'Good afternoon, Jane.'],
    [20, 'Good evening, Jane.'],
  ])('renders empty overview states at hour %s', async (hour, heading) => {
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(hour)
    server.use(http.get(`${base}/api/account/access-requests`, () => json({ items: [], pagination: pagination(0) })))
    renderWithClient(<AccountOverviewPage />)
    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy()
    expect(await screen.findByText("You're all caught up")).toBeTruthy()
    expect(screen.getByText('No active sessions')).toBeTruthy()
    expect(screen.getByText('Basic')).toBeTruthy()
  })

  it('keeps overview metrics pending until their resources load', async () => {
    const delayedJson = async (payload: Record<string, unknown>) => {
      await delay(100)
      return json(payload)
    }
    server.use(
      http.get(`${base}/api/account/security`, () => delayedJson({ security: store.security })),
      http.get(`${base}/api/account/agents`, () => delayedJson({ items: [], pagination: pagination(0) })),
      http.get(`${base}/api/auth/organization/list`, async () => {
        await delay(100)
        return json([])
      }),
      http.get(`${base}/api/account/access-requests`, () => json({ items: [], pagination: pagination(0) })),
    )

    renderWithClient(<AccountOverviewPage />)
    expect(await screen.findByRole('heading', { name: /Jane\.$/ })).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })

  it('keeps an overview access request open when denial fails', async () => {
    server.use(
      http.get(`${base}/api/account/access-requests`, () =>
        json({ items: [accessRequest()], pagination: pagination(1) }),
      ),
      http.put(`${base}/api/account/access-requests/request-1/decision`, () =>
        json({ message: 'Decision unavailable.' }, { status: 500 }),
      ),
    )
    renderWithClient(<AccountOverviewPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review request' }))
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Review Agent access request' })).toBeTruthy())
  })

  it('renders collection loading, failure, and empty Agent states', async () => {
    server.use(http.get(`${base}/api/account/access-requests`, () => json({ items: [], pagination: pagination(0) })))
    const overview = renderWithClient(<AccountOverviewPage />)
    expect(screen.getByText('Loading account center')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: /Jane\.$/ })).toBeTruthy()
    overview.unmount()

    renderWithClient(<AccountAgentsPage />)
    expect(await screen.findByText('No Agent identities')).toBeTruthy()
    openTab('Requests · 0')
    expect(await screen.findByText('No pending requests')).toBeTruthy()
  })

  it('[spec: account-center/authorized-app-separation] reviews and revokes only Realmroot application grants', async () => {
    store.applications = [
      {
        id: 'consent-1',
        applicationName: 'Project board',
        scopes: ['openid', 'profile'],
        grantedAt: '2026-08-01T00:00:00.000Z',
        expiresAt: null,
      },
      {
        id: 'consent-2',
        applicationName: 'Reports',
        scopes: ['openid'],
        grantedAt: '2026-08-02T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    ]
    let revoked = false
    server.use(
      http.delete(`${base}/api/account/application-authorizations/consent-1`, () => {
        revoked = true
        return new Response(null, { status: 204 })
      }),
    )

    renderWithClient(<AccountApplicationsPage />)
    const reviewButtons = await screen.findAllByRole('button', { name: 'Review' })
    fireEvent.click(reviewButtons[0]!)
    expect(await screen.findByRole('heading', { name: 'Project board' })).toBeTruthy()
    expect(screen.getByText('Never')).toBeTruthy()
    closeDialogWithEscape()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Review' }))[1]!)
    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Review' }))[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke access' }).at(-1)!)
    await waitFor(() => expect(revoked).toBe(true))
  })

  it('shows an empty authorized application collection', async () => {
    renderWithClient(<AccountApplicationsPage />)
    expect(await screen.findByText('No authorized applications')).toBeTruthy()
  })

  it('keeps application and Agent decisions open when their mutations fail', async () => {
    store.applications = [
      {
        id: 'consent-failure',
        applicationName: 'Unreliable app',
        scopes: ['openid'],
        grantedAt: '2026-08-01T00:00:00.000Z',
      },
    ]
    server.use(
      http.delete(`${base}/api/account/application-authorizations/consent-failure`, () =>
        json({ message: 'Revoke failed.' }, { status: 500 }),
      ),
    )
    const applications = renderWithClient(<AccountApplicationsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke access' }).at(-1)!)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Unreliable app' })).toBeTruthy())
    applications.unmount()

    store.agentIdentities = [agent('agent-active', 'Build Agent', 'active')]
    server.use(
      http.get(`${base}/api/account/access-requests`, () =>
        json({ items: [accessRequest()], pagination: pagination(1) }),
      ),
      http.delete(`${base}/api/account/agents/agent-active`, () =>
        json({ message: 'Deletion failed.' }, { status: 500 }),
      ),
      http.put(`${base}/api/account/access-requests/request-1/decision`, () =>
        json({ message: 'Decision failed.' }, { status: 500 }),
      ),
    )
    renderWithClient(<AccountAgentsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Agent' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete Agent' }).at(-1)!)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Build Agent' })).toBeTruthy())
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!)

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Requests · 1' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Review request' }))
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Review Agent access request' })).toBeTruthy())
  })

  it('manages Agent identities and denies pending access requests', async () => {
    store.agentIdentities = [
      agent('agent-active', 'Build Agent', 'active'),
      agent('agent-inactive', 'Old Agent', 'inactive'),
    ]
    let deleted = false
    let activated = false
    let deactivated = false
    let decision: unknown = null
    server.use(
      http.get(`${base}/api/account/access-requests`, () =>
        json({ items: [accessRequest()], pagination: pagination(1) }),
      ),
      http.delete(`${base}/api/account/agents/agent-active`, () => {
        deleted = true
        return new Response(null, { status: 204 })
      }),
      http.delete(`${base}/api/account/agents/agent-active/activation`, () => {
        deactivated = true
        return new Response(null, { status: 204 })
      }),
      http.put(`${base}/api/account/agents/agent-inactive/activation`, () => {
        activated = true
        return new Response(null, { status: 204 })
      }),
      http.put(`${base}/api/account/access-requests/request-1/decision`, async ({ request }) => {
        decision = await request.json()
        return json({ id: 'request-1', status: 'denied' })
      }),
    )

    renderWithClient(<AccountAgentsPage />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Manage' }))[0]!)
    expect(await screen.findByRole('heading', { name: 'Build Agent' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Agent' }))
    await waitFor(() => expect(deactivated).toBe(true))
    closeDialogWithEscape()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Manage' }))[1]!)
    fireEvent.click(screen.getByRole('button', { name: 'Activate Agent' }))
    await waitFor(() => expect(activated).toBe(true))
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Manage' }))[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Agent' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete Agent' }).at(-1)!)
    await waitFor(() => expect(deleted).toBe(true))

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Requests · 1' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Review request' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Review request' }))
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(decision).toEqual({ decision: 'deny' }))
  })

  it('creates, switches, accepts, and declines Organizations', async () => {
    let created: unknown = null
    const invitationActions: string[] = []
    server.use(
      http.get(`${base}/api/auth/organization/list`, () =>
        json([
          { id: 'org-active', name: 'Active org', slug: 'active-org', createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'org-other', name: 'Other org', slug: 'other-org', createdAt: '2026-02-01T00:00:00.000Z' },
        ]),
      ),
      http.get(`${base}/api/auth/organization/list-user-invitations`, () =>
        json([
          {
            id: 'invitation-accept',
            organizationName: 'Join us',
            role: 'admin',
            status: 'pending',
            createdAt: '2026-08-01T00:00:00.000Z',
            expiresAt: '2099-08-08T00:00:00.000Z',
          },
          {
            id: 'invitation-decline',
            organizationName: 'No thanks',
            role: 'member',
            status: 'pending',
            createdAt: '2026-08-01T00:00:00.000Z',
            expiresAt: '2099-08-08T00:00:00.000Z',
          },
        ]),
      ),
      http.post(`${base}/api/auth/organization/create`, async ({ request }) => {
        created = await request.json()
        return json({ id: 'org-new', ...(created as object) })
      }),
      http.post(`${base}/api/auth/organization/accept-invitation`, async ({ request }) => {
        invitationActions.push(`accept:${JSON.stringify(await request.json())}`)
        return json({ invitation: { id: 'invitation-accept' } })
      }),
      http.post(`${base}/api/auth/organization/reject-invitation`, async ({ request }) => {
        invitationActions.push(`reject:${JSON.stringify(await request.json())}`)
        return json({ invitation: { id: 'invitation-decline' } })
      }),
    )
    renderWithClient(<AccountOrganizationsPage />)
    expect(await screen.findByText('Active org')).toBeTruthy()
    expect(screen.queryByText('Current')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Switch' })).toBeNull()
    expect(screen.getAllByRole('link', { name: 'Manage' })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: 'Decline' })[1]!)
    await waitFor(() => expect(invitationActions).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: 'New organization' }))
    closeDialogWithEscape()
    fireEvent.click(screen.getByRole('button', { name: 'New organization' }))
    fireEvent.submit(screen.getByRole('button', { name: 'Create organization' }).closest('form')!)
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Payments Team' } })
    expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('payments-team')
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'payments-platform' } })
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Payments Platform' } })
    expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('payments-platform')
    fireEvent.submit(screen.getByRole('button', { name: 'Create organization' }).closest('form')!)
    await waitFor(() => expect(created).toMatchObject({ name: 'Payments Platform', slug: 'payments-platform' }))
  })

  it('hides Organization creation and renders an empty collection when policy disallows it', async () => {
    store.access.canCreateOrganization = false
    renderWithClient(<AccountOrganizationsPage />)
    expect(await screen.findByText('No organizations yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New organization' })).toBeNull()
  })

  it('keeps Organization creation open when provisioning fails', async () => {
    server.use(
      http.post(`${base}/api/auth/organization/create`, () =>
        json({ message: 'Organization creation failed.' }, { status: 500 }),
      ),
    )
    renderWithClient(<AccountOrganizationsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New organization' }))
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Failure team' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }))
    await waitFor(() => expect(screen.getByLabelText('Organization name')).toBeTruthy())
  })

  it('[spec: admin-console/admin-govern-organization] manages Organization members, invitations, profile, and deletion', async () => {
    const actions: Array<{ path: string; body: unknown }> = []
    store.access.platformOperator = true
    server.use(
      ...organizationDetailHandlers('owner'),
      http.put(`${base}/api/organizations/org-family/members/:memberId/roles`, async ({ request }) => {
        actions.push({ path: '/api/auth/organization/update-member-role', body: await request.json() })
        return json({ roles: ['admin'] })
      }),
      http.get(`${base}/api/organizations/org-family/roles`, () =>
        json({
          items: ['owner', 'admin', 'developer', 'member'].map((key) => ({ key, displayName: key, predefined: true })),
          pagination: pagination(4),
        }),
      ),
      http.post(`${base}/api/organizations/org-family/invitations`, async ({ request }) => {
        actions.push({ path: '/api/organizations/org-family/invitations', body: await request.json() })
        return json({ id: 'inv-new' }, { status: 201 })
      }),
      organizationMutationHandler(actions),
    )

    renderWithClient(<AccountOrganizationDetailPage organizationId="org-family" />)
    expect(await screen.findByRole('heading', { name: 'Family' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open Console' })).toBeNull()

    await openOrganizationSection('members')
    fireEvent.click(await screen.findByRole('button', { name: 'Invite member' }))
    closeDialogWithEscape()
    fireEvent.click(await screen.findByRole('button', { name: 'Invite member' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByLabelText('member'))
    fireEvent.click(screen.getByLabelText('developer'))
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
    await waitFor(() =>
      expect(actions).toContainEqual({
        path: '/api/organizations/org-family/invitations',
        body: { email: 'new@example.com', roles: ['developer'] },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    closeDialogWithEscape()
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    fireEvent.change(screen.getByLabelText('Access level'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save access level' }))
    await waitFor(() => expect(actions.some((action) => action.path.endsWith('/update-member-role'))).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove member' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove member' }).at(-1)!)
    await waitFor(() => expect(actions.some((action) => action.path.endsWith('/remove-member'))).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    closeDialogWithEscape()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invitation' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel invitation' }).at(-1)!)
    await waitFor(() => expect(actions.some((action) => action.path.endsWith('/cancel-invitation'))).toBe(true))

    await openOrganizationSection('settings')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    closeDialogWithEscape()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Family workspace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(actions.some((action) => action.path.endsWith('/update'))).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete organization' }))
    await waitFor(() => expect(actions.some((action) => action.path.endsWith('/delete'))).toBe(true))
    expect(navigate).toHaveBeenCalledWith({ to: '/organizations' })
  })

  it('lets a non-owner leave and shows empty Organization authority surfaces', async () => {
    const actions: Array<{ path: string; body: unknown }> = []
    store.access.consoleOrganizations = [{ organizationId: 'org-family', level: 'developer' }]
    server.use(...organizationDetailHandlers('member', { empty: true }), organizationMutationHandler(actions))

    renderWithClient(<AccountOrganizationDetailPage organizationId="org-family" />)
    expect(await screen.findByText('Member')).toBeTruthy()
    await openOrganizationSection('agents')
    expect(await screen.findByText('No Organization Agents')).toBeTruthy()
    await openOrganizationSection('roles')
    expect(await screen.findByText('Your Organization Roles')).toBeTruthy()
    expect(screen.getByText('Assigned Roles')).toBeTruthy()
    await openOrganizationSection('settings')
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    fireEvent.click(screen.getByRole('button', { name: 'Leave organization' }))
    await waitFor(() => expect(actions.some((action) => action.path.endsWith('/leave'))).toBe(true))
  })

  it('composes capability content into its Organization section', async () => {
    server.use(...organizationDetailHandlers('member'))

    renderWithClient(
      <AccountOrganizationDetailPage
        content={<p>Organization applications inventory</p>}
        organizationId="org-family"
        section="applications"
      />,
    )

    expect(await screen.findByText('Organization applications inventory')).toBeTruthy()
  })

  it('keeps Organization management editors open when server mutations fail', async () => {
    store.access.platformOperator = true
    server.use(
      ...organizationDetailHandlers('owner'),
      http.get(`${base}/api/organizations/org-family/roles`, () =>
        json({
          items: ['owner', 'admin', 'developer', 'member'].map((key) => ({ key, displayName: key, predefined: true })),
          pagination: pagination(4),
        }),
      ),
      http.post(`${base}/api/organizations/org-family/invitations`, () =>
        json({ message: 'Organization mutation failed.' }, { status: 500 }),
      ),
      http.delete(`${base}/api/organizations/org-family/members/:memberId`, () =>
        json({ message: 'Organization mutation failed.' }, { status: 500 }),
      ),
      http.delete(`${base}/api/organizations/org-family/invitations/:invitationId`, () =>
        json({ message: 'Organization mutation failed.' }, { status: 500 }),
      ),
      http.post(`${base}/api/auth/organization/:action`, () =>
        json({ message: 'Organization mutation failed.' }, { status: 500 }),
      ),
    )
    renderWithClient(<AccountOrganizationDetailPage organizationId="org-family" />)
    expect(await screen.findByRole('heading', { name: 'Family' })).toBeTruthy()

    await openOrganizationSection('members')
    fireEvent.click(await screen.findByRole('button', { name: 'Invite member' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'failed@example.com' } })
    fireEvent.click(await screen.findByLabelText('member'))
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText('Select at least one Role.')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('member'))
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    fireEvent.change(screen.getByLabelText('Access level'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save access level' }))
    await waitFor(() => expect(screen.getByLabelText('Access level')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove member' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove member' }).at(-1)!)
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invitation' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel invitation' }).at(-1)!)
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await openOrganizationSection('settings')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Failed update' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete organization' }))
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
  })

  it('surfaces Organization Agent query failures', async () => {
    server.use(
      http.get(`${base}/api/account/organizations/org-family/agents`, () =>
        json({ message: 'Agents unavailable.' }, { status: 500 }),
      ),
      ...organizationDetailHandlers('member'),
    )
    renderWithClient(<AccountOrganizationDetailPage organizationId="org-family" />)
    expect(await screen.findByRole('heading', { name: 'Family' })).toBeTruthy()

    await openOrganizationSection('agents')
    expect((await screen.findByRole('alert')).textContent).toContain('Agents unavailable.')
  })

  it('renders Organization load failures', async () => {
    server.use(
      http.get(`${base}/api/auth/organization/get-full-organization`, () =>
        json({ message: 'Organization unavailable' }, { status: 500 }),
      ),
      http.get(`${base}/api/account/organizations/org-family/agents`, () =>
        json({ items: [], pagination: pagination(0) }),
      ),
    )
    renderWithClient(<AccountOrganizationDetailPage organizationId="org-family" />)
    expect((await screen.findByRole('alert')).textContent).toContain('Organization unavailable')
  })
})

async function openOrganizationSection(section: 'members' | 'roles' | 'agents' | 'settings') {
  cleanup()
  renderWithClient(<AccountOrganizationDetailPage organizationId="org-family" section={section} />)
  await screen.findByRole('heading', { name: 'Family' })
}

function openTab(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false })
}

function closeDialogWithEscape() {
  fireEvent.keyDown(document, { key: 'Escape' })
}

function agent(id: string, name: string, status: 'active' | 'inactive') {
  return {
    id,
    issuer: 'https://identity.example.com/api/auth',
    subject: `${id}-subject`,
    name,
    homeSpace: { type: 'personal' as const, userId: store.profile.id },
    status,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    bindings: [],
  }
}

function accessRequest(): AccessRequestApproval {
  return {
    id: 'request-1',
    agentId: 'agent-active',
    agent: { id: 'agent-active', name: 'Build Agent' },
    resourceServerId: 'resource-server-1',
    resourceServer: { id: 'resource-server-1', name: 'Projects API' },
    authorizationDetail: {
      name: 'Projects',
      description: null,
      metadata: {},
      authorizationDetailTemplates: [],
    },
    scopes: ['projects:read'],
    authorizationDetails: [],
    requiresAccountConnection: true,
    reason: 'Read projects',
    status: 'pending',
    interaction: {
      type: 'user-approval',
      status: 'pending',
      url: 'https://identity.example.com/approve',
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
    links: { self: '/api/access-requests/request-1', credentials: null },
    credentialOffer: null,
    expiresAt: '2099-01-01T00:00:00.000Z',
    decidedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

function pagination(total: number) {
  return { limit: 100, offset: 0, total, hasMore: false, nextOffset: null }
}

function organizationDetailHandlers(role: string, options: { empty?: boolean } = {}) {
  const agents = options.empty ? [] : [agent('agent-family', 'Family assistant', 'active')]
  return [
    http.get(`${base}/api/auth/organization/get-full-organization`, () =>
      json({
        id: 'org-family',
        name: 'Family',
        slug: 'family',
        createdAt: '2026-08-01T00:00:00.000Z',
        members: [
          {
            id: 'member-current',
            userId: store.profile.id,
            role,
            user: { id: store.profile.id, name: store.profile.displayName, email: store.profile.email },
            createdAt: '2026-08-01T00:00:00.000Z',
          },
          {
            id: 'member-other',
            userId: 'user-2',
            role: 'developer',
            user: { id: 'user-2', name: 'Alex Doe', email: 'alex@example.com' },
            createdAt: '2026-08-02T00:00:00.000Z',
          },
        ],
        invitations: options.empty
          ? []
          : [
              {
                id: 'invitation-1',
                email: 'invitee@example.com',
                role: 'member',
                status: 'pending',
                createdAt: '2026-08-03T00:00:00.000Z',
                expiresAt: '2099-08-10T00:00:00.000Z',
              },
              {
                id: 'invitation-old',
                email: 'old@example.com',
                role: 'member',
                status: 'accepted',
                createdAt: '2026-07-03T00:00:00.000Z',
                expiresAt: '2026-07-10T00:00:00.000Z',
              },
            ],
      }),
    ),
    http.get(`${base}/api/account/organizations/org-family/agents`, () =>
      json({ items: agents, pagination: pagination(agents.length) }),
    ),
  ]
}

function organizationMutationHandler(actions: Array<{ path: string; body: unknown }>) {
  return http.post(`${base}/api/auth/organization/:action`, async ({ params, request }) => {
    const body = await request.json()
    actions.push({ path: `/api/auth/organization/${String(params.action)}`, body })
    return json({ success: true })
  })
}
