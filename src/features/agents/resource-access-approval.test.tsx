import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetRequestDeduplicationForTests } from '@/lib/request-deduplication'
import { ResourceAccessApproval } from './resource-access-approval'

const api = vi.hoisted(() => ({
  createAccountConnection: vi.fn(),
  decideAgentResourceApproval: vi.fn(),
  getAgentResourceApproval: vi.fn(),
  listApprovalAuthorizationDetailCatalog: vi.fn(),
  listApprovalAccountConnections: vi.fn(),
}))

vi.mock('@/lib/api/account', () => api)

Element.prototype.scrollIntoView ??= () => {}

const request = {
  id: 'request-1',
  agentId: 'agent-1',
  resourceServerId: 'resource-1',
  scopes: ['projects:read'],
  authorizationDetails: [{ type: 'project', project_id: 'project-1', actions: ['read'] }],
  requiresAccountConnection: true,
  reason: 'Read project status',
  status: 'pending' as const,
  interaction: { type: 'user-approval' as const, status: 'pending' as const, url: null, expiresAt: null },
  links: { self: '/api/access-requests/request-1', credentials: null },
  credentialOffer: null,
  expiresAt: '2026-08-01T01:00:00.000Z',
  decidedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  agent: { id: 'agent-1', name: 'Release helper' },
  resourceServer: { id: 'resource-1', name: 'ZPan' },
  authorizationDetail: {
    name: 'Project One',
    description: null,
    metadata: {},
    authorizationDetailTemplates: [{ type: 'project' }],
  },
}

const connection = {
  id: 'connection-1',
  apiResourceId: 'resource-1',
  owner: { type: 'user' as const, userId: 'user-1' },
  displayName: 'ZPan Demo',
  subjectHint: '••••demo',
  scopes: ['projects:read'],
  authorizationDetails: [{ actions: ['read'], project_id: 'project-1', type: 'project' }],
  status: 'active' as const,
  credentialExpiresAt: null,
  authorizationUrl: null,
  expiresAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

const nativeAuthorizationDetails = [{ type: 'realmroot_authority', authority: 'account', id: 'user-1' }]

const nativeRequest = {
  ...request,
  scopes: ['account:read'],
  authorizationDetails: nativeAuthorizationDetails,
  requiresAccountConnection: false,
  resourceServer: { id: 'resource-1', name: 'Realmroot' },
  authorizationDetail: {
    name: 'Example User',
    description: null,
    metadata: { authority: 'account', userId: 'user-1' },
    authorizationDetailTemplates: [{ type: 'realmroot_authority', authority: 'account' }],
  },
}

describe('Agent resource access approval', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/agent/access')
    window.location.hash = 'token=approval%20token'
    window.sessionStorage.clear()
    api.getAgentResourceApproval.mockResolvedValue(request)
    api.decideAgentResourceApproval.mockResolvedValue({ ...request, status: 'approved' })
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [connection],
      pagination: { page: Math.floor(0 / 50) + 1, pageSize: 50, totalItems: 1, totalPages: Math.ceil(1 / 50) },
    })
    api.listApprovalAuthorizationDetailCatalog.mockResolvedValue({
      items: [
        {
          authorizationDetail: { type: 'project', project_id: 'project-1', actions: ['read'] },
          display: { label: 'Project One' },
          connectionStatus: 'authorized',
          authorizedScopes: [],
          requestableScopes: [],
        },
      ],
      pagination: { page: Math.floor(0 / 50) + 1, pageSize: 50, totalItems: 1, totalPages: Math.ceil(1 / 50) },
    })
    api.createAccountConnection.mockResolvedValue({
      ...connection,
      id: 'connection-2',
      status: 'pending_authorization',
      authorizationUrl: 'https://zpan.test/authorize',
    })
  })

  afterEach(() => {
    cleanup()
    resetRequestDeduplicationForTests()
    vi.clearAllMocks()
    window.location.hash = ''
  })

  it('approves exact one-token access', async () => {
    render(<ResourceAccessApproval />)

    expect(await screen.findByText('Release helper')).toBeTruthy()
    expect(screen.getByText('agent-1')).toBeTruthy()
    expect(screen.getByText('Project One')).toBeTruthy()
    expect(screen.getByText(request.resourceServer.id)).toBeTruthy()
    expect(screen.queryByText('connection-1')).toBeNull()
    expect(screen.getByText('ZPan Demo')).toBeTruthy()
    expect(screen.queryByRole('radio', { name: 'ZPan Demo' })).toBeNull()
    expect(screen.getAllByText('projects:read')).toHaveLength(1)
    expect(screen.getByText('Read project status')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Requested authorization details' })).toBeNull()
    expect(screen.queryByText('{"actions":["read"],"project_id":"project-1","type":"project"}')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Authorize' }))

    await waitFor(() =>
      expect(api.decideAgentResourceApproval).toHaveBeenCalledWith('request-1', 'approval token', {
        decision: 'approve',
        mode: 'once',
        authorizationDetails: [{ type: 'project', project_id: 'project-1', actions: ['read'] }],
      }),
    )
    expect(await screen.findByText('Resource access approved')).toBeTruthy()
  })

  it('loads a new approval when the browser reuses the page for another token', async () => {
    api.getAgentResourceApproval.mockImplementation(async (token: string) =>
      token === 'second approval token'
        ? {
            ...request,
            id: 'request-2',
            authorizationDetail: { ...request.authorizationDetail, name: 'Project Two' },
          }
        : request,
    )

    render(<ResourceAccessApproval />)
    expect(await screen.findByText('Project One')).toBeTruthy()

    window.location.hash = 'token=second%20approval%20token'
    fireEvent(window, new HashChangeEvent('hashchange'))

    expect(await screen.findByText('Project Two')).toBeTruthy()
    await waitFor(() => expect(api.getAgentResourceApproval).toHaveBeenLastCalledWith('second approval token'))
  })

  it('shows a connection provider error and keeps account connection retryable', async () => {
    window.history.replaceState(
      null,
      '',
      '/agent/access?resource_connection=failed&error=invalid_target&error_description=The+requested+workspace+resource+is+not+configured#token=approval%20token',
    )
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [],
      pagination: { page: Math.floor(0 / 50) + 1, pageSize: 50, totalItems: 0, totalPages: Math.ceil(0 / 50) },
    })

    render(<ResourceAccessApproval />)

    expect(await screen.findByText('The requested workspace resource is not configured')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect account' })).toBeTruthy()
  })

  it('requires one explicit concrete selection for a generic authorization detail', async () => {
    api.getAgentResourceApproval.mockResolvedValue({
      ...request,
      authorizationDetails: [{ type: 'project' }],
    })
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [
        {
          ...connection,
          authorizationDetails: [
            { type: 'project', project_id: 'project-1' },
            { type: 'project', project_id: 'project-2' },
          ],
        },
      ],
      pagination: { page: Math.floor(0 / 50) + 1, pageSize: 50, totalItems: 1, totalPages: Math.ceil(1 / 50) },
    })
    api.listApprovalAuthorizationDetailCatalog.mockResolvedValue({
      items: [
        {
          authorizationDetail: { type: 'project', project_id: 'project-1' },
          display: { label: 'Project One' },
          connectionStatus: 'authorized',
          authorizedScopes: [],
          requestableScopes: [],
        },
        {
          authorizationDetail: { type: 'project', project_id: 'project-2' },
          display: { label: 'Project Two' },
          connectionStatus: 'authorized',
          authorizedScopes: ['projects:read'],
          requestableScopes: [],
        },
      ],
      pagination: { page: Math.floor(0 / 50) + 1, pageSize: 50, totalItems: 2, totalPages: Math.ceil(2 / 50) },
    })

    render(<ResourceAccessApproval />)

    const approve = await screen.findByRole('button', { name: 'Authorize' })
    expect(approve.hasAttribute('disabled')).toBe(true)
    const select = screen.getByLabelText('Authorization detail 1')
    fireEvent.click(select)
    fireEvent.click(await screen.findByRole('option', { name: 'Project Two' }))
    expect(approve.hasAttribute('disabled')).toBe(false)
    fireEvent.click(approve)
    await waitFor(() =>
      expect(api.decideAgentResourceApproval).toHaveBeenCalledWith('request-1', 'approval token', {
        decision: 'approve',
        mode: 'once',
        authorizationDetails: [{ type: 'project', project_id: 'project-2' }],
      }),
    )
  })

  it('preserves multiple concrete authorization details in one approval', async () => {
    const authorizationDetails = [
      { type: 'project', project_id: 'project-1', actions: ['read'] },
      { type: 'project', project_id: 'project-2', actions: ['read'] },
    ]
    api.getAgentResourceApproval.mockResolvedValue({ ...request, authorizationDetails })
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [{ ...connection, authorizationDetails }],
      pagination: { page: Math.floor(0 / 50) + 1, pageSize: 50, totalItems: 1, totalPages: Math.ceil(1 / 50) },
    })

    render(<ResourceAccessApproval />)

    fireEvent.click(await screen.findByRole('button', { name: 'Authorize' }))
    await waitFor(() =>
      expect(api.decideAgentResourceApproval).toHaveBeenCalledWith('request-1', 'approval token', {
        decision: 'approve',
        mode: 'once',
        authorizationDetails,
      }),
    )
  })

  it('loads every catalog page before presenting generic authorization details', async () => {
    api.getAgentResourceApproval.mockResolvedValue({
      ...request,
      authorizationDetails: [{ type: 'project' }],
    })
    api.listApprovalAuthorizationDetailCatalog
      .mockResolvedValueOnce({
        items: [
          {
            authorizationDetail: { type: 'project', project_id: 'project-1' },
            display: { label: 'Project One' },
            connectionStatus: 'authorized',
            authorizedScopes: [],
            requestableScopes: [],
          },
        ],
        pagination: { page: Math.floor(0 / 100) + 1, pageSize: 100, totalItems: 101, totalPages: Math.ceil(101 / 100) },
      })
      .mockResolvedValueOnce({
        items: [
          {
            authorizationDetail: { type: 'project', project_id: 'project-101' },
            display: { label: 'Project One Hundred One' },
            connectionStatus: 'authorized',
            authorizedScopes: [],
            requestableScopes: [],
          },
        ],
        pagination: {
          page: Math.floor(100 / 100) + 1,
          pageSize: 100,
          totalItems: 101,
          totalPages: Math.ceil(101 / 100),
        },
      })

    render(<ResourceAccessApproval />)

    fireEvent.click(await screen.findByLabelText('Authorization detail 1'))
    expect(await screen.findByRole('option', { name: 'Project One Hundred One' })).toBeTruthy()
    expect(api.listApprovalAuthorizationDetailCatalog).toHaveBeenNthCalledWith(1, 'request-1', 'approval token', {
      page: 1,
      pageSize: 100,
    })
    expect(api.listApprovalAuthorizationDetailCatalog).toHaveBeenNthCalledWith(2, 'request-1', 'approval token', {
      page: 2,
      pageSize: 100,
    })
  })

  it('shows a native resource name without requiring an account connection', async () => {
    api.getAgentResourceApproval.mockResolvedValue({
      ...request,
      authorizationDetails: [],
      requiresAccountConnection: false,
      resourceServer: { id: 'resource-1', name: 'Billing API' },
      authorizationDetail: null,
    })
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [],
      pagination: { page: Math.floor(0 / 50) + 1, pageSize: 50, totalItems: 0, totalPages: Math.ceil(0 / 50) },
    })
    render(<ResourceAccessApproval />)

    expect(await screen.findByText('Billing API')).toBeTruthy()
    expect(screen.queryByText(/Connect your Billing API account/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Authorize' }).hasAttribute('disabled')).toBe(false)
  })

  it('[spec: agent-identity/native-api-resource-access-request] approves exact native Account authority once without an account connection', async () => {
    api.getAgentResourceApproval.mockResolvedValue(nativeRequest)
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [],
      pagination: { page: Math.floor(0 / 50) + 1, pageSize: 50, totalItems: 0, totalPages: Math.ceil(0 / 50) },
    })
    render(<ResourceAccessApproval />)

    fireEvent.click(await screen.findByRole('button', { name: 'Authorize' }))
    await waitFor(() =>
      expect(api.decideAgentResourceApproval).toHaveBeenCalledWith('request-1', 'approval token', {
        decision: 'approve',
        mode: 'once',
        authorizationDetails: nativeAuthorizationDetails,
      }),
    )
  })

  it('approves exact native Account authority persistently without an account connection', async () => {
    api.getAgentResourceApproval.mockResolvedValue(nativeRequest)
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [],
      pagination: { page: Math.floor(0 / 50) + 1, pageSize: 50, totalItems: 0, totalPages: Math.ceil(0 / 50) },
    })
    render(<ResourceAccessApproval />)

    await screen.findByText('Example User')
    fireEvent.click(screen.getByRole('radio', { name: 'Persistent until revoked' }))
    fireEvent.click(screen.getByRole('button', { name: 'Authorize' }))
    await waitFor(() =>
      expect(api.decideAgentResourceApproval).toHaveBeenCalledWith('request-1', 'approval token', {
        decision: 'approve',
        mode: 'persistent',
        authorizationDetails: nativeAuthorizationDetails,
      }),
    )
  })

  it('does not submit external access while authorization details are unresolved', async () => {
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [{ ...connection, authorizationDetails: [] }],
      pagination: { page: Math.floor(0 / 50) + 1, pageSize: 50, totalItems: 1, totalPages: Math.ceil(1 / 50) },
    })

    render(<ResourceAccessApproval />)

    const approve = await screen.findByRole('button', { name: 'Authorize' })
    expect(approve.hasAttribute('disabled')).toBe(true)
    fireEvent.click(approve)
    expect(api.decideAgentResourceApproval).not.toHaveBeenCalled()
  })

  it('[spec: agent-identity/external-resource-first-access] connects an account before allowing a separate approval', async () => {
    api.getAgentResourceApproval.mockResolvedValue(request)
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [],
      pagination: { page: Math.floor(0 / 50) + 1, pageSize: 50, totalItems: 0, totalPages: Math.ceil(0 / 50) },
    })
    render(<ResourceAccessApproval />)

    expect(await screen.findByRole('heading', { name: 'Connect your ZPan account' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Authorize' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Grant lifetime' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Connect account' }))
    await waitFor(() =>
      expect(api.createAccountConnection).toHaveBeenCalledWith({
        context: 'access-request',
        accessRequestId: 'request-1',
        approvalToken: 'approval token',
      }),
    )
    expect(api.decideAgentResourceApproval).not.toHaveBeenCalled()
  })

  it('shows that the controller request is still loading before enabling decisions', () => {
    api.getAgentResourceApproval.mockReturnValue(new Promise(() => {}))
    api.listApprovalAccountConnections.mockReturnValue(new Promise(() => {}))

    render(<ResourceAccessApproval />)

    expect(screen.getByText('Loading resource access request…')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Authorize' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
  })

  it('[spec: agent-identity/external-resource-first-access] displays the connected account after OAuth and waits for approval', async () => {
    window.history.replaceState(null, '', '/agent/access')
    window.location.hash = ''
    window.sessionStorage.setItem('realmroot.resource-access-approval-token', 'approval token')
    api.getAgentResourceApproval.mockResolvedValue(request)
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [{ ...connection, id: 'connection-2' }],
      pagination: { page: Math.floor(0 / 50) + 1, pageSize: 50, totalItems: 1, totalPages: Math.ceil(1 / 50) },
    })

    render(<ResourceAccessApproval />)

    expect(await screen.findByText('ZPan Demo')).toBeTruthy()
    expect(api.decideAgentResourceApproval).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Authorize' }))
    await waitFor(() =>
      expect(api.decideAgentResourceApproval).toHaveBeenCalledWith('request-1', 'approval token', {
        decision: 'approve',
        mode: 'once',
        authorizationDetails: [{ type: 'project', project_id: 'project-1', actions: ['read'] }],
      }),
    )
    expect(await screen.findByText('Resource access approved')).toBeTruthy()
    expect(window.sessionStorage.getItem('realmroot.resource-access-approval-token')).toBeNull()
  })

  it('[spec: agent-identity/resource-account-reauthorization] requires scope expansion for an existing account', async () => {
    api.getAgentResourceApproval.mockResolvedValue({
      ...request,
      scopes: ['projects:read', 'projects:write'],
    })

    render(<ResourceAccessApproval />)

    expect(await screen.findByRole('heading', { name: 'Update ZPan permissions to continue' })).toBeTruthy()
    expect(screen.getByText('ZPan Demo')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Authorize' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Grant lifetime' })).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Update permissions' }))
    await waitFor(() =>
      expect(api.createAccountConnection).toHaveBeenCalledWith({
        context: 'access-request',
        accessRequestId: 'request-1',
        approvalToken: 'approval token',
      }),
    )
    expect(api.decideAgentResourceApproval).not.toHaveBeenCalled()
  })

  it('[spec: agent-identity/resource-account-reauthorization] reports catalog failures without starting permission update', async () => {
    api.listApprovalAuthorizationDetailCatalog.mockRejectedValue(new Error('Authorization context lookup failed.'))

    render(<ResourceAccessApproval />)

    expect(await screen.findByText('Authorization context lookup failed.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Update permissions' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Authorize' })).toBeTruthy()
    expect(api.createAccountConnection).not.toHaveBeenCalled()
  })

  it('rejects multiple connected accounts instead of presenting selection controls', async () => {
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [connection, { ...connection, id: 'connection-2' }],
      pagination: { page: Math.floor(0 / 50) + 1, pageSize: 50, totalItems: 2, totalPages: Math.ceil(2 / 50) },
    })

    render(<ResourceAccessApproval />)

    expect(await screen.findByText('This resource has more than one connected account.')).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /ZPan Demo/ })).toBeNull()
  })

  it('reports account connection failures from Error and unknown values', async () => {
    api.getAgentResourceApproval.mockResolvedValue(request)
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [],
      pagination: { page: Math.floor(0 / 50) + 1, pageSize: 50, totalItems: 0, totalPages: Math.ceil(0 / 50) },
    })
    api.createAccountConnection
      .mockRejectedValueOnce(new Error('Account authorization expired'))
      .mockRejectedValueOnce('offline')
    render(<ResourceAccessApproval />)
    await screen.findByText('agent-1')

    fireEvent.click(screen.getByRole('button', { name: 'Connect account' }))
    expect(await screen.findByText('Account authorization expired')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Connect account' }))
    expect(await screen.findByText('Unable to start account authorization.')).toBeTruthy()
  })

  it('approves access until the selected expiry and can deny', async () => {
    const { unmount } = render(<ResourceAccessApproval />)
    await screen.findByText('agent-1')
    fireEvent.click(screen.getByRole('radio', { name: 'Until a date and time' }))
    const approve = screen.getByRole('button', { name: 'Authorize' })
    expect(approve.hasAttribute('disabled')).toBe(true)
    const expiry = screen.getByLabelText('Grant expiry')
    fireEvent.change(expiry, { target: { value: '2020-08-01T00:30' } })
    expect(approve.hasAttribute('disabled')).toBe(true)
    expect(expiry.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(expiry, { target: { value: '2099-08-01T00:30' } })
    expect(approve.hasAttribute('disabled')).toBe(false)
    fireEvent.click(approve)
    await waitFor(() =>
      expect(api.decideAgentResourceApproval).toHaveBeenCalledWith(
        'request-1',
        'approval token',
        expect.objectContaining({
          decision: 'approve',
          mode: 'until',
          expiresAt: new Date('2099-08-01T00:30').toISOString(),
        }),
      ),
    )
    unmount()

    api.decideAgentResourceApproval.mockResolvedValue({ ...request, status: 'denied' })
    window.location.hash = 'token=approval%20token'
    render(<ResourceAccessApproval />)
    await screen.findByText('agent-1')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Resource access denied')).toBeTruthy()
  })

  it('reports missing tokens and load failures', async () => {
    window.location.hash = ''
    window.sessionStorage.clear()
    render(<ResourceAccessApproval />)
    expect(
      screen.getByText('This resource access request is incomplete. Start again from the requesting Agent.'),
    ).toBeTruthy()
    cleanup()

    window.location.hash = 'token=token'
    api.getAgentResourceApproval.mockRejectedValue(new Error('Approval expired'))
    render(<ResourceAccessApproval />)
    expect(await screen.findByText('Approval expired')).toBeTruthy()
    cleanup()

    api.getAgentResourceApproval.mockRejectedValue('offline')
    render(<ResourceAccessApproval />)
    expect(await screen.findByText('Unable to load the Agent resource request.')).toBeTruthy()
  })

  it('does not let an older approval token response overwrite the current request', async () => {
    let resolveOldRequest: (value: typeof request) => void = () => undefined
    api.getAgentResourceApproval
      .mockImplementationOnce(() => new Promise((resolve) => (resolveOldRequest = resolve)))
      .mockResolvedValueOnce(request)
    render(<ResourceAccessApproval />)

    window.location.hash = 'token=new-token'
    fireEvent(window, new HashChangeEvent('hashchange'))
    expect(await screen.findByText('Release helper')).toBeTruthy()

    await act(async () => {
      resolveOldRequest({ ...request, agent: { id: 'stale-agent', name: 'Stale Agent' } })
      await Promise.resolve()
    })
    expect(screen.queryByText('Stale Agent')).toBeNull()
    expect(screen.getByText('Release helper')).toBeTruthy()
  })

  it('reports decision failures from Error and unknown values', async () => {
    api.decideAgentResourceApproval
      .mockRejectedValueOnce(new Error('Decision expired'))
      .mockRejectedValueOnce('offline')
    render(<ResourceAccessApproval />)
    await screen.findByText('agent-1')
    fireEvent.click(screen.getByRole('button', { name: 'Authorize' }))
    expect(await screen.findByText('Decision expired')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Unable to decide the Agent resource request.')).toBeTruthy()
  })
})
