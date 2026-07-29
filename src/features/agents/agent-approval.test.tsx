import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentApproval } from '@/features/agents/agent-approval'
import { decideAgentCapability } from '@/lib/auth-client'

vi.mock('@/lib/auth-client', () => ({
  decideAgentCapability: vi.fn().mockResolvedValue({ status: 'approved' }),
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
    expect(screen.getByText('cli-host')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Requested capabilities' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve permissions' }))

    await waitFor(() =>
      expect(decideAgentCapability).toHaveBeenCalledWith({
        agentId: 'agent-1',
        userCode: 'ABCD-1234',
        action: 'approve',
        capabilities: ['account.profile.read'],
      }),
    )
    expect(await screen.findByRole('heading', { name: 'Authorization successful' })).toBeTruthy()
    expect(screen.getByText('You can safely close this page.')).toBeTruthy()
    expect(
      screen.getByText(
        'The requested Agent permissions have been granted. The Agent can now retry its Restish command.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve permissions' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Requested capabilities' })).toBeNull()
  })

  it('shows a completion page after approving Agent login [spec: agent-identity/agent-identity-enrollment]', async () => {
    window.history.pushState(null, '', '/agent/approve?agent_id=agent-1&code=ABCD-1234')

    render(<AgentApproval />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve login' }))

    expect(await screen.findByRole('heading', { name: 'Authorization successful' })).toBeTruthy()
    expect(screen.getByText('The Agent login has been approved. Restish will continue automatically.')).toBeTruthy()
    expect(screen.getByText('You can safely close this page.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve login' })).toBeNull()
  })

  it('keeps actions disabled without an AgentAuth approval query', () => {
    render(<AgentApproval />)

    expect((screen.getByRole('button', { name: 'Approve login' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('surfaces delegated approval failures', async () => {
    vi.mocked(decideAgentCapability).mockRejectedValueOnce(new Error('Invalid user code'))
    window.history.pushState(null, '', '/agent/approve?agent_id=agent-1&code=BAD-CODE')

    render(<AgentApproval />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve login' }))

    expect(await screen.findByText('Invalid user code')).toBeTruthy()
  })

  it('denies a pending request and replaces the approval controls [spec: agent-identity/agent-capability-denial]', async () => {
    window.history.pushState(null, '', '/agent/approve?agent_id=agent-1&code=ABCD-1234&capability=management:read')

    render(<AgentApproval />)
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() =>
      expect(decideAgentCapability).toHaveBeenCalledWith({
        agentId: 'agent-1',
        userCode: 'ABCD-1234',
        action: 'deny',
        capabilities: ['management:read'],
      }),
    )
    expect(await screen.findByRole('heading', { name: 'Authorization denied' })).toBeTruthy()
    expect(screen.getByText('You can safely close this page.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull()
  })
})
