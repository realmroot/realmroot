import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResourceAccessApproval } from './resource-access-approval'

const api = vi.hoisted(() => ({
  decideAgentResourceApproval: vi.fn(),
  getAgentResourceApproval: vi.fn(),
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

describe('Agent resource access approval', () => {
  beforeEach(() => {
    window.location.hash = 'token=approval%20token'
    api.getAgentResourceApproval.mockResolvedValue(request)
    api.decideAgentResourceApproval.mockResolvedValue({ ...request, status: 'approved' })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    window.location.hash = ''
  })

  it('approves exact one-token access', async () => {
    render(<ResourceAccessApproval />)

    expect(await screen.findByText('agent-1')).toBeTruthy()
    expect(screen.getByText('connection-1')).toBeTruthy()
    expect(screen.getByText('projects:read')).toBeTruthy()
    expect(screen.getByText('Read project status')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve exact access' }))

    await waitFor(() =>
      expect(api.decideAgentResourceApproval).toHaveBeenCalledWith('request-1', 'approval token', {
        decision: 'approve',
        mode: 'once',
      }),
    )
    expect(await screen.findByText('Resource access approved')).toBeTruthy()
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
