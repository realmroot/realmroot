import { cleanup, render, screen } from '@testing-library/react'
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
      '/agent/resource-connection/approve?resource_connection=connected#token=approval%20token',
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
    expect(screen.getByText('No Agent access grant was created.')).toBeTruthy()
  })
})
