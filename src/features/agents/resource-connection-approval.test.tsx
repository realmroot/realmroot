import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResourceConnectionApprovalPage } from './resource-connection-approval'

const api = vi.hoisted(() => ({
  createAccountConnection: vi.fn(),
  getResourceConnectionApproval: vi.fn(),
}))

vi.mock('@/lib/api/account', () => api)

const approval = {
  id: 'request-1',
  agentId: 'agent-1',
  apiResourceId: 'resource-1',
  scopes: ['projects:read'],
  reason: 'Connect project storage',
  status: 'pending' as const,
  accountConnectionId: null,
  approval: null,
  createdAt: '2026-08-03T00:00:00.000Z',
  expiresAt: '2026-08-03T00:10:00.000Z',
  agent: { id: 'agent-1', name: 'Upload Agent' },
  resource: { id: 'resource-1', name: 'ZPan' },
  accountConnection: null,
}

describe('Agent resource connection approval', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/agent/resource-connection/approve')
    window.location.hash = 'token=approval%20token'
    window.sessionStorage.clear()
    api.getResourceConnectionApproval.mockResolvedValue(approval)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('offers a connection-only approval before any account is linked', async () => {
    render(<ResourceConnectionApprovalPage />)

    expect(await screen.findByText('Upload Agent')).toBeTruthy()
    expect(screen.getByText('ZPan')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect account' })).toBeTruthy()
    expect(screen.getByText('This step only connects the account. Agent access is approved separately.')).toBeTruthy()
    expect(api.getResourceConnectionApproval).toHaveBeenCalledWith('approval token')
  })

  it('confirms the account connection after OAuth without claiming an Agent grant', async () => {
    window.history.replaceState(
      null,
      '',
      '/agent/resource-connection/approve?resource_connection=connected&account_connection_id=connection-1#token=approval%20token',
    )
    api.getResourceConnectionApproval.mockResolvedValue({
      ...approval,
      status: 'connected',
      accountConnectionId: 'connection-1',
      accountConnection: {
        id: 'connection-1',
        apiResourceId: 'resource-1',
        owner: { type: 'user', userId: 'user-1' },
        displayName: 'ZPan account',
        subjectHint: '••••user',
        scopes: ['projects:read'],
        authorizationDetails: [{ type: 'workspace', identifier: 'workspace-1' }],
        status: 'active',
        credentialExpiresAt: null,
        authorizationUrl: null,
        expiresAt: null,
        createdAt: '2026-08-03T00:00:00.000Z',
        updatedAt: '2026-08-03T00:00:00.000Z',
      },
    })

    render(<ResourceConnectionApprovalPage />)

    expect(await screen.findByText('Account connected')).toBeTruthy()
    expect(screen.getByText('Resource access remains a separate approval.')).toBeTruthy()
  })

  it('does not treat a callback for another account connection as success', async () => {
    window.history.replaceState(
      null,
      '',
      '/agent/resource-connection/approve?resource_connection=connected&account_connection_id=connection-other#token=approval%20token',
    )
    api.getResourceConnectionApproval.mockResolvedValue({
      ...approval,
      status: 'connected',
      accountConnectionId: 'connection-1',
      accountConnection: {
        id: 'connection-1',
        apiResourceId: 'resource-1',
        owner: { type: 'user', userId: 'user-1' },
        displayName: 'ZPan account',
        subjectHint: '••••user',
        scopes: ['projects:read'],
        authorizationDetails: [{ type: 'workspace', identifier: 'workspace-1' }],
        status: 'active',
        credentialExpiresAt: null,
        authorizationUrl: null,
        expiresAt: null,
        createdAt: '2026-08-03T00:00:00.000Z',
        updatedAt: '2026-08-03T00:00:00.000Z',
      },
    })

    render(<ResourceConnectionApprovalPage />)

    expect(await screen.findByText('The completed account connection does not match this request.')).toBeTruthy()
    expect(screen.queryByText('Account connected')).toBeNull()
  })

  it('shows the provider error and keeps the connection request retryable', async () => {
    window.history.replaceState(
      null,
      '',
      '/agent/resource-connection/approve?resource_connection=failed&error=invalid_target&error_description=The+requested+workspace+resource+is+not+configured#token=approval%20token',
    )

    render(<ResourceConnectionApprovalPage />)

    expect(await screen.findByText('The requested workspace resource is not configured')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect account' })).toBeTruthy()
    expect(screen.queryByText('Invalid input: expected string, received undefined')).toBeNull()
  })

  it('restores an approval token from session storage when OAuth removes the fragment', async () => {
    window.location.hash = ''
    window.sessionStorage.setItem('realmroot.resource-connection-approval-token', 'stored token')

    render(<ResourceConnectionApprovalPage />)

    expect(await screen.findByText('Upload Agent')).toBeTruthy()
    expect(api.getResourceConnectionApproval).toHaveBeenCalledWith('stored token')
  })

  it('explains when the connection request has no approval token', async () => {
    window.location.hash = ''

    render(<ResourceConnectionApprovalPage />)

    expect(
      await screen.findByText('This resource connection request is incomplete. Start again from the requesting Agent.'),
    ).toBeTruthy()
    expect(api.getResourceConnectionApproval).not.toHaveBeenCalled()
  })

  it('surfaces a failed approval lookup', async () => {
    api.getResourceConnectionApproval.mockRejectedValue(new Error('Connection request expired.'))

    render(<ResourceConnectionApprovalPage />)

    expect(await screen.findByText('Connection request expired.')).toBeTruthy()
  })

  it('falls back to a stable lookup error for non-Error failures', async () => {
    api.getResourceConnectionApproval.mockRejectedValue('network failure')

    render(<ResourceConnectionApprovalPage />)

    expect(await screen.findByText('Unable to load the resource connection request.')).toBeTruthy()
  })

  it('updates an existing account connection and reports authorization startup failures', async () => {
    api.getResourceConnectionApproval.mockResolvedValue({
      ...approval,
      reason: null,
      accountConnection: {
        id: 'connection-1',
        apiResourceId: 'resource-1',
        owner: { type: 'user', userId: 'user-1' },
        displayName: 'ZPan account',
        subjectHint: '••••user',
        scopes: ['projects:read'],
        authorizationDetails: [],
        status: 'active',
        credentialExpiresAt: null,
        authorizationUrl: null,
        expiresAt: null,
        createdAt: '2026-08-03T00:00:00.000Z',
        updatedAt: '2026-08-03T00:00:00.000Z',
      },
    })
    api.createAccountConnection.mockRejectedValue(new Error('Provider is unavailable.'))

    render(<ResourceConnectionApprovalPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update account connection' }))

    await waitFor(() =>
      expect(api.createAccountConnection).toHaveBeenCalledWith({
        context: 'connection-request',
        approvalToken: 'approval token',
      }),
    )
    expect(await screen.findByText('Provider is unavailable.')).toBeTruthy()
    expect(screen.queryByText('Connect project storage')).toBeNull()
  })

  it('rejects a connection response without an authorization URL', async () => {
    api.createAccountConnection.mockResolvedValue({ authorizationUrl: null })

    render(<ResourceConnectionApprovalPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect account' }))

    expect(await screen.findByText('The authorization URL was not returned.')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Connect account' }).disabled).toBe(false)
  })

  it('uses a stable startup error for non-Error failures', async () => {
    api.createAccountConnection.mockRejectedValue('network failure')

    render(<ResourceConnectionApprovalPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect account' }))

    expect(await screen.findByText('Unable to start account authorization.')).toBeTruthy()
  })
})
