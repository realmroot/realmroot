import type { AccessRequestApproval, AccountConnection } from '@shared/api/agent-api'
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
    realmOperator: false,
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
          items: [{ ...accessRequest(), authorizationDetails: requestedAuthorizationDetails }],
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
    expect(screen.getByText('Strong')).toBeTruthy()
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
    expect(screen.getByText("You're all caught up")).toBeTruthy()
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
      http.get(`${base}/api/account/applications`, () => delayedJson({ applications: [] })),
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
    expect(await screen.findByText('No Agent identities belong to your account.')).toBeTruthy()
    openTab('Requests · 0')
    expect(await screen.findByText('No Agent access requests need your review.')).toBeTruthy()
  })

  it('reviews and revokes authorized applications', async () => {
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
      http.delete(`${base}/api/account/applications/consent-1`, () => {
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

  it('[spec: account-center/resource-account-connections] shows and disconnects an external API resource account', async () => {
    let disconnected = false
    server.use(
      http.get(`${base}/api/account/api-resources`, () =>
        json({
          items: [
            {
              id: 'resource-zpan',
              identifier: 'zpan',
              name: 'ZPan Local Dynamic Test',
              resourceUrl: 'http://localhost:5185/api',
            },
          ],
          pagination: pagination(1),
        }),
      ),
      http.get(`${base}/api/account/account-connections`, () =>
        json({
          items: [
            {
              id: 'connection-zpan',
              apiResourceId: 'resource-zpan',
              owner: { type: 'user', userId: 'user-1' },
              displayName: 'agent-controller-0802@example.com',
              subjectHint: '••••g9io',
              scopes: ['objects:create', 'objects:read'],
              authorizationDetails: [],
              status: 'active',
              credentialExpiresAt: null,
              authorizationUrl: null,
              expiresAt: null,
              createdAt: '2026-08-02T00:00:00.000Z',
              updatedAt: '2026-08-02T00:00:00.000Z',
            },
          ],
          pagination: pagination(1),
        }),
      ),
      http.delete(`${base}/api/account/account-connections/connection-zpan`, () => {
        disconnected = true
        return new Response(null, { status: 204 })
      }),
    )

    renderWithClient(<AccountApplicationsPage />)
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Resource accounts' }), { button: 0, ctrlKey: false })

    expect(await screen.findByText('ZPan Local Dynamic Test')).toBeTruthy()
    expect(screen.getByText('agent-controller-0802@example.com')).toBeTruthy()
    expect(screen.getByText('objects:create objects:read')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' }).at(-1)!)
    await waitFor(() => expect(disconnected).toBe(true))
  })

  it('handles resource account loading, errors, inactive connections, and missing labels', async () => {
    server.use(
      http.get(`${base}/api/account/api-resources`, async () => {
        await delay('infinite')
        return json({ items: [], pagination: pagination(0) })
      }),
      http.get(`${base}/api/account/account-connections`, async () => {
        await delay('infinite')
        return json({ items: [], pagination: pagination(0) })
      }),
    )

    const loading = renderWithClient(<AccountApplicationsPage />)
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Resource accounts' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('Loading connected resource accounts…')).toBeTruthy()
    loading.unmount()

    server.resetHandlers()
    server.use(
      http.get(`${base}/api/account/api-resources`, () => json({ message: 'Resources unavailable.' }, { status: 500 })),
    )

    const failed = renderWithClient(<AccountApplicationsPage />)
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Resource accounts' }), { button: 0, ctrlKey: false })
    expect((await screen.findByRole('alert')).textContent).toBe('Resources unavailable.')
    failed.unmount()

    server.resetHandlers()
    server.use(
      http.get(`${base}/api/account/api-resources`, () =>
        json({
          items: [{ id: 'resource-known', identifier: 'known', name: 'Known API', resourceUrl: 'https://api.test' }],
          pagination: pagination(1),
        }),
      ),
      http.get(`${base}/api/account/account-connections`, () =>
        json({
          items: [
            accountConnection('connection-hint', 'resource-missing', 'active', null, '••••hint'),
            accountConnection('connection-unknown', 'resource-known', 'active', null, null),
            accountConnection('connection-inactive', 'resource-known', 'revoked', 'Revoked account', null),
          ],
          pagination: pagination(3),
        }),
      ),
    )

    renderWithClient(<AccountApplicationsPage />)
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Resource accounts' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('API resource')).toBeTruthy()
    expect(screen.getByText('••••hint')).toBeTruthy()
    expect(screen.getByText('Known API')).toBeTruthy()
    expect(screen.getByText('Unknown owner')).toBeTruthy()
    expect(screen.queryByText('Revoked account')).toBeNull()
  })

  it('shows an empty authorized application collection', async () => {
    renderWithClient(<AccountApplicationsPage />)
    expect(await screen.findByText('No applications are authorized for this account.')).toBeTruthy()
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
      http.delete(`${base}/api/account/applications/consent-failure`, () =>
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
        json({ message: 'Retirement failed.' }, { status: 500 }),
      ),
      http.put(`${base}/api/account/access-requests/request-1/decision`, () =>
        json({ message: 'Decision failed.' }, { status: 500 }),
      ),
    )
    renderWithClient(<AccountAgentsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retire Agent' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Retire Agent' }).at(-1)!)
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
      agent('agent-retired', 'Old Agent', 'retired'),
    ]
    let retired = false
    let decision: unknown = null
    server.use(
      http.get(`${base}/api/account/access-requests`, () =>
        json({ items: [accessRequest()], pagination: pagination(1) }),
      ),
      http.delete(`${base}/api/account/agents/agent-active`, () => {
        retired = true
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
    closeDialogWithEscape()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Manage' }))[1]!)
    expect((screen.getByRole('button', { name: 'Retire Agent' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Manage' }))[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Retire Agent' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Retire Agent' }).at(-1)!)
    await waitFor(() => expect(retired).toBe(true))

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
    let switched: string | null = null
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
      http.post(`${base}/api/auth/organization/set-active`, async ({ request }) => {
        const body = (await request.json()) as { organizationId: string }
        switched = body.organizationId
        return json({ id: body.organizationId })
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
    store.activeOrganizationId = 'org-active'

    renderWithClient(<AccountOrganizationsPage />)
    expect((await screen.findAllByText('Current')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: 'Switch' })[0]!)
    await waitFor(() => expect(switched).toBe('org-other'))
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
    fireEvent.submit(screen.getByRole('button', { name: 'Create organization' }).closest('form')!)
    await waitFor(() => expect(created).toMatchObject({ name: 'Payments Team', slug: 'payments-platform' }))
  })

  it('hides Organization creation and renders an empty collection when policy disallows it', async () => {
    store.access.canCreateOrganization = false
    renderWithClient(<AccountOrganizationsPage />)
    expect(await screen.findByText('You do not belong to an Organization yet.')).toBeTruthy()
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

  it('manages Organization members, invitations, profile, and deletion', async () => {
    const actions: Array<{ path: string; body: unknown }> = []
    store.access.realmOperator = true
    server.use(...organizationDetailHandlers('owner'), organizationMutationHandler(actions))

    renderWithClient(<AccountOrganizationDetailPage organizationId="org-family" />)
    expect(await screen.findByRole('heading', { name: 'Family' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Console' })).toBeTruthy()

    openTab('Members')
    fireEvent.click(await screen.findByRole('button', { name: 'Invite member' }))
    closeDialogWithEscape()
    fireEvent.click(await screen.findByRole('button', { name: 'Invite member' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('Access level'), { target: { value: 'developer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
    await waitFor(() => expect(actions.some((action) => action.path.endsWith('/invite-member'))).toBe(true))

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

    openTab('Settings')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    closeDialogWithEscape()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Family workspace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(actions.some((action) => action.path.endsWith('/update'))).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete organization' }))
    await waitFor(() => expect(actions.some((action) => action.path.endsWith('/delete'))).toBe(true))
    expect(navigate).toHaveBeenCalledWith({ to: '/account/organizations' })
  })

  it('lets a non-owner leave and shows empty Organization authority surfaces', async () => {
    const actions: Array<{ path: string; body: unknown }> = []
    store.access.consoleOrganizations = [{ organizationId: 'org-family', level: 'developer' }]
    server.use(...organizationDetailHandlers('member', { empty: true }), organizationMutationHandler(actions))

    renderWithClient(<AccountOrganizationDetailPage organizationId="org-family" />)
    expect(await screen.findByText('Member')).toBeTruthy()
    openTab('Agents')
    expect(await screen.findByText('No Organization Agents')).toBeTruthy()
    openTab('Role assignments')
    expect(await screen.findByText('No effective Role assignments')).toBeTruthy()
    expect(screen.getByText('No active Agent access grants')).toBeTruthy()
    openTab('Settings')
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    fireEvent.click(screen.getByRole('button', { name: 'Leave organization' }))
    await waitFor(() => expect(actions.some((action) => action.path.endsWith('/leave'))).toBe(true))
  })

  it('keeps Organization management editors open when server mutations fail', async () => {
    store.access.realmOperator = true
    server.use(
      ...organizationDetailHandlers('owner'),
      http.post(`${base}/api/auth/organization/:action`, () =>
        json({ message: 'Organization mutation failed.' }, { status: 500 }),
      ),
    )
    renderWithClient(<AccountOrganizationDetailPage organizationId="org-family" />)
    expect(await screen.findByRole('heading', { name: 'Family' })).toBeTruthy()

    openTab('Members')
    fireEvent.click(await screen.findByRole('button', { name: 'Invite member' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'failed@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    fireEvent.change(screen.getByLabelText('Access level'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save access level' }))
    await waitFor(() => expect(screen.getByLabelText('Access level')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    openTab('Settings')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Failed update' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete organization' }))
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
  })

  it('surfaces Organization Agent and authority query failures', async () => {
    server.use(
      http.get(`${base}/api/account/organizations/org-family/agents`, () =>
        json({ message: 'Agents unavailable.' }, { status: 500 }),
      ),
      http.get(`${base}/api/role-assignments`, () =>
        json({ message: 'Role assignments unavailable.' }, { status: 500 }),
      ),
      http.get(`${base}/api/agent-access-grants`, () =>
        json({ message: 'Agent grants unavailable.' }, { status: 500 }),
      ),
      ...organizationDetailHandlers('member'),
    )
    renderWithClient(<AccountOrganizationDetailPage organizationId="org-family" />)
    expect(await screen.findByRole('heading', { name: 'Family' })).toBeTruthy()

    openTab('Agents')
    expect((await screen.findByRole('alert')).textContent).toContain('Agents unavailable.')
    openTab('Role assignments')
    expect((await screen.findByRole('alert')).textContent).toContain('Role assignments unavailable.')
  })

  it('renders Organization load failures', async () => {
    server.use(
      http.get(`${base}/api/auth/organization/get-full-organization`, () =>
        json({ message: 'Organization unavailable' }, { status: 500 }),
      ),
      http.get(`${base}/api/account/organizations/org-family/agents`, () =>
        json({ items: [], pagination: pagination(0) }),
      ),
      http.get(`${base}/api/role-assignments`, () => json({ assignments: [], pagination: pagination(0) })),
      http.get(`${base}/api/agent-access-grants`, () => json({ items: [], pagination: pagination(0) })),
    )
    renderWithClient(<AccountOrganizationDetailPage organizationId="org-family" />)
    expect((await screen.findByRole('alert')).textContent).toContain('Organization unavailable')
  })
})

function openTab(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false })
}

function closeDialogWithEscape() {
  fireEvent.keyDown(document, { key: 'Escape' })
}

function agent(id: string, name: string, status: 'active' | 'recovering' | 'retired') {
  return {
    id,
    issuer: 'https://identity.example.com/api/auth',
    subject: `${id}-subject`,
    name,
    homeSpace: { type: 'personal' as const, userId: store.profile.id },
    status,
    retiredAt: status === 'retired' ? '2026-08-01T00:00:00.000Z' : null,
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
    target: { type: 'api-resource', apiResourceId: 'resource-1' },
    resource: { id: 'resource-1', name: 'Projects API', authorizationDetailTemplates: [] },
    scopes: ['projects:read'],
    authorizationDetails: [],
    reason: 'Read projects',
    status: 'pending',
    approval: { url: 'https://identity.example.com/approve', expiresAt: '2099-01-01T00:00:00.000Z' },
    grantId: null,
    expiresAt: '2099-01-01T00:00:00.000Z',
    decidedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

function accountConnection(
  id: string,
  apiResourceId: string,
  status: AccountConnection['status'],
  displayName: string | null,
  subjectHint: string | null,
): AccountConnection {
  return {
    id,
    apiResourceId,
    owner: { type: 'user', userId: 'user-1' },
    displayName,
    subjectHint,
    scopes: ['objects:read'],
    authorizationDetails: [],
    status,
    credentialExpiresAt: null,
    authorizationUrl: null,
    expiresAt: null,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
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
    http.get(`${base}/api/role-assignments`, ({ request }) => {
      if (options.empty || new URL(request.url).searchParams.get('context') === 'realm') {
        return json({ assignments: [], pagination: pagination(0) })
      }
      return json({
        assignments: [
          {
            id: 'assignment-1',
            roleId: 'role-1',
            subjectType: 'user',
            subjectId: store.profile.id,
            organizationId: 'org-family',
            assignedByUserId: 'admin-1',
            expiresAt: null,
            revokedAt: null,
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
        ],
        pagination: pagination(1),
      })
    }),
    http.get(`${base}/api/roles/role-1`, () =>
      json({
        id: 'role-1',
        key: 'family.viewer',
        name: 'Family viewer',
        description: null,
        system: false,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      }),
    ),
    http.get(`${base}/api/roles/role-1/permissions`, () => json({ permissions: [] })),
    http.get(`${base}/api/agent-access-grants`, () =>
      json({
        items: options.empty
          ? []
          : [
              {
                id: 'grant-1',
                agentId: 'agent-family',
                resource: { id: 'resource-1', identifier: 'projects', name: 'Projects API' },
                scopes: ['projects:read'],
                mode: 'persistent',
                status: 'active',
                expiresAt: null,
                createdAt: '2026-08-01T00:00:00.000Z',
              },
            ],
        pagination: pagination(options.empty ? 0 : 1),
      }),
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
