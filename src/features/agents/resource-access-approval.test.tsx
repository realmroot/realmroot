import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResourceAccessApproval } from './resource-access-approval'

const api = vi.hoisted(() => ({
  createAccountConnection: vi.fn(),
  decideAgentResourceApproval: vi.fn(),
  getAgentResourceApproval: vi.fn(),
  listApprovalAccountConnections: vi.fn(),
  listExternalApiResources: vi.fn(),
}))

vi.mock('@/lib/api/account', () => api)

const request = {
  id: 'request-1',
  agentId: 'agent-1',
  target: {
    type: 'api-resource' as const,
    apiResourceId: 'resource-1',
    accountConnectionId: 'connection-1',
  },
  scopes: ['projects:read'],
  reason: 'Read project status',
  status: 'pending' as const,
  approval: null,
  grantId: null,
  expiresAt: '2026-08-01T01:00:00.000Z',
  decidedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

const connection = {
  id: 'connection-1',
  apiResourceId: 'resource-1',
  owner: { type: 'user' as const, userId: 'user-1' },
  displayName: 'ZPan Demo',
  subjectHint: '••••demo',
  scopes: ['projects:read'],
  status: 'active' as const,
  credentialExpiresAt: null,
  authorizationUrl: null,
  expiresAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

describe('Agent resource access approval', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/agent/resource-access/approve')
    window.location.hash = 'token=approval%20token'
    window.sessionStorage.clear()
    api.getAgentResourceApproval.mockResolvedValue(request)
    api.decideAgentResourceApproval.mockResolvedValue({ ...request, status: 'approved' })
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [connection],
      pagination: { limit: 50, offset: 0, total: 1, hasMore: false, nextOffset: null },
    })
    api.listExternalApiResources.mockResolvedValue({
      items: [
        {
          id: 'resource-1',
          name: 'ZPan',
          identifier: 'zpan',
          resourceUrl: 'https://zpan.test/api',
        },
      ],
      pagination: { limit: 50, offset: 0, total: 1, hasMore: false, nextOffset: null },
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
    vi.clearAllMocks()
    window.location.hash = ''
  })

  it('approves exact one-token access', async () => {
    render(<ResourceAccessApproval />)

    expect(await screen.findByText('agent-1')).toBeTruthy()
    expect(screen.queryByText('connection-1')).toBeNull()
    expect(screen.getByText('ZPan Demo')).toBeTruthy()
    expect(screen.queryByRole('radio', { name: 'ZPan Demo' })).toBeNull()
    expect(screen.getAllByText('projects:read')).toHaveLength(2)
    expect(screen.getByText('Read project status')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve exact access' }))

    await waitFor(() =>
      expect(api.decideAgentResourceApproval).toHaveBeenCalledWith('request-1', 'approval token', {
        decision: 'approve',
        mode: 'once',
        accountConnectionId: 'connection-1',
      }),
    )
    expect(await screen.findByText('Resource access approved')).toBeTruthy()
  })

  it('[spec: agent-identity/external-resource-first-access] connects an account before allowing a separate approval', async () => {
    api.getAgentResourceApproval.mockResolvedValue({
      ...request,
      target: { type: 'api-resource', apiResourceId: 'resource-1' },
    })
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [],
      pagination: { limit: 50, offset: 0, total: 0, hasMore: false, nextOffset: null },
    })
    render(<ResourceAccessApproval />)

    expect(await screen.findByText('Connect your ZPan account before deciding this Agent request.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve exact access' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Connect ZPan account' }))
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
    api.listExternalApiResources.mockReturnValue(new Promise(() => {}))

    render(<ResourceAccessApproval />)

    expect(screen.getByText('Loading resource access request…')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve exact access' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Deny' }).hasAttribute('disabled')).toBe(true)
  })

  it('[spec: agent-identity/external-resource-first-access] displays the connected account after OAuth and waits for approval', async () => {
    window.history.replaceState(null, '', '/agent/resource-access/approve')
    window.location.hash = ''
    window.sessionStorage.setItem('realmroot.resource-access-approval-token', 'approval token')
    api.getAgentResourceApproval.mockResolvedValue({
      ...request,
      target: { type: 'api-resource', apiResourceId: 'resource-1' },
    })
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [{ ...connection, id: 'connection-2' }],
      pagination: { limit: 50, offset: 0, total: 1, hasMore: false, nextOffset: null },
    })

    render(<ResourceAccessApproval />)

    expect(await screen.findByText('ZPan Demo')).toBeTruthy()
    expect(api.decideAgentResourceApproval).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Approve exact access' }))
    await waitFor(() =>
      expect(api.decideAgentResourceApproval).toHaveBeenCalledWith('request-1', 'approval token', {
        decision: 'approve',
        mode: 'once',
        accountConnectionId: 'connection-2',
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

    expect(
      await screen.findByText('This account needs expanded authorization before it can cover every requested scope.'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve exact access' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Expand ZPan account access' }))
    await waitFor(() =>
      expect(api.createAccountConnection).toHaveBeenCalledWith({
        context: 'access-request',
        accessRequestId: 'request-1',
        approvalToken: 'approval token',
      }),
    )
    expect(api.decideAgentResourceApproval).not.toHaveBeenCalled()
  })

  it('rejects multiple connected accounts instead of presenting selection controls', async () => {
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [connection, { ...connection, id: 'connection-2' }],
      pagination: { limit: 50, offset: 0, total: 2, hasMore: false, nextOffset: null },
    })

    render(<ResourceAccessApproval />)

    expect(await screen.findByText('This resource has more than one connected account.')).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /ZPan Demo/ })).toBeNull()
  })

  it('reports account connection failures from Error and unknown values', async () => {
    api.getAgentResourceApproval.mockResolvedValue({
      ...request,
      target: { type: 'api-resource', apiResourceId: 'resource-1' },
    })
    api.listApprovalAccountConnections.mockResolvedValue({
      items: [],
      pagination: { limit: 50, offset: 0, total: 0, hasMore: false, nextOffset: null },
    })
    api.createAccountConnection
      .mockRejectedValueOnce(new Error('Account authorization expired'))
      .mockRejectedValueOnce('offline')
    render(<ResourceAccessApproval />)
    await screen.findByText('agent-1')

    fireEvent.click(screen.getByRole('button', { name: 'Connect ZPan account' }))
    expect(await screen.findByText('Account authorization expired')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Connect ZPan account' }))
    expect(await screen.findByText('Unable to start account authorization.')).toBeTruthy()
  })

  it('approves access until the selected expiry and can deny', async () => {
    const { unmount } = render(<ResourceAccessApproval />)
    await screen.findByText('agent-1')
    fireEvent.click(screen.getByRole('radio', { name: 'Until a date and time' }))
    const approve = screen.getByRole('button', { name: 'Approve exact access' })
    expect(approve.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Grant expiry'), { target: { value: '2026-08-01T00:30' } })
    fireEvent.click(approve)
    await waitFor(() =>
      expect(api.decideAgentResourceApproval).toHaveBeenCalledWith(
        'request-1',
        'approval token',
        expect.objectContaining({
          decision: 'approve',
          mode: 'until',
          expiresAt: new Date('2026-08-01T00:30').toISOString(),
        }),
      ),
    )
    unmount()

    api.decideAgentResourceApproval.mockResolvedValue({ ...request, status: 'denied' })
    render(<ResourceAccessApproval />)
    await screen.findByText('agent-1')
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(await screen.findByText('Resource access denied')).toBeTruthy()
  })

  it('reports missing tokens and load failures', async () => {
    window.location.hash = ''
    window.sessionStorage.clear()
    render(<ResourceAccessApproval />)
    expect(screen.getByText('Approval token is missing.')).toBeTruthy()
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

  it('reports decision failures from Error and unknown values', async () => {
    api.decideAgentResourceApproval
      .mockRejectedValueOnce(new Error('Decision expired'))
      .mockRejectedValueOnce('offline')
    render(<ResourceAccessApproval />)
    await screen.findByText('agent-1')
    fireEvent.click(screen.getByRole('button', { name: 'Approve exact access' }))
    expect(await screen.findByText('Decision expired')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(await screen.findByText('Unable to decide the Agent resource request.')).toBeTruthy()
  })
})
