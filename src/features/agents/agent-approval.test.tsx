import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentApproval } from '@/features/agents/agent-approval'
import { approveAgentCapability } from '@/lib/auth-client'

vi.mock('@/lib/auth-client', () => ({
  approveAgentCapability: vi.fn().mockResolvedValue({ status: 'approved' }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.history.pushState(null, '', '/')
})

describe('AgentApproveRoute', () => {
  it('approves delegated account capabilities from the device authorization query [spec: account-center/agent-approval]', async () => {
    window.history.pushState(
      null,
      '',
      '/agent/approve?agent_id=agent-1&code=ABCD-1234&host=cli-host&capability=account.profile.read',
    )

    render(<AgentApproval />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() =>
      expect(approveAgentCapability).toHaveBeenCalledWith({
        agentId: 'agent-1',
        userCode: 'ABCD-1234',
        capabilities: ['account.profile.read'],
      }),
    )
    expect(screen.getByText('cli-host')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Requested capabilities' })).toBeTruthy()
    expect(await screen.findByText('Agent access approved.')).toBeTruthy()
  })

  it('keeps actions disabled without an AgentAuth approval query', () => {
    render(<AgentApproval />)

    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull()
  })

  it('surfaces delegated approval failures', async () => {
    vi.mocked(approveAgentCapability).mockRejectedValueOnce(new Error('Invalid user code'))
    window.history.pushState(null, '', '/agent/approve?agent_id=agent-1&code=BAD-CODE')

    render(<AgentApproval />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByText('Invalid user code')).toBeTruthy()
  })
})
