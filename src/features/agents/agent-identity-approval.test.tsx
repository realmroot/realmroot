import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentIdentityApproval } from '@/features/agents/agent-identity-approval'

const api = vi.hoisted(() => ({
  approveAgentEnrollment: vi.fn(),
  getAgentApprovalPreview: vi.fn(),
  getAgentEnrollment: vi.fn(),
}))
const protocolApi = vi.hoisted(() => ({ decideProtocolAgentEnrollment: vi.fn() }))

vi.mock('@/lib/api/account', () => api)
vi.mock('@/lib/auth-client', () => protocolApi)

describe('Agent stable identity approval', () => {
  afterEach(cleanup)

  beforeEach(() => {
    window.history.pushState(null, '', '/agent/enrollment?intent_id=intent-1')
    api.getAgentApprovalPreview.mockResolvedValue({
      agent: { id: 'protocol-agent-1', name: 'Build Agent' },
      host: { id: 'host-1', name: 'Codex' },
    })
    api.getAgentEnrollment.mockResolvedValue({
      id: 'intent-1',
      agentId: null,
      nickname: 'Build Agent',
      username: 'build-agent',
      runtime: 'codex',
      kind: 'new_identity',
      homeSpace: { type: 'personal', userId: 'user-1' },
      status: 'pending',
      expiresAt: '2026-08-01T00:10:00.000Z',
      decidedAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    })
    api.approveAgentEnrollment.mockResolvedValue({
      agent: {
        id: 'identity-1',
        issuer: 'https://auth.example.com',
        subject: 'agt_1',
        username: 'build-agent',
        name: 'Build Agent',
        runtime: 'codex',
        homeSpace: { type: 'personal', userId: 'user-1' },
        status: 'active',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    })
    protocolApi.decideProtocolAgentEnrollment.mockResolvedValue({ status: 'approved' })
  })

  it('approves an Agent-initiated stable identity enrollment [spec: agent-identity/agent-identity-enrollment]', async () => {
    render(<AgentIdentityApproval />)

    expect(await screen.findByText('Build Agent')).toBeTruthy()
    expect(screen.getByText('Personal account')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Authorize' }))

    await waitFor(() => expect(api.approveAgentEnrollment).toHaveBeenCalledWith('intent-1'))
    expect(await screen.findByText('Build Agent is ready on this host.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Agent enrollment approved.' })).toBeTruthy()
  })

  it('does not approve without an enrollment intent id', () => {
    window.history.pushState(null, '', '/agent/enrollment')
    render(<AgentIdentityApproval />)

    expect(screen.getByRole('heading', { name: 'Agent enrollment unavailable.' })).toBeTruthy()
    expect(screen.getByText('This Agent enrollment request is incomplete.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders completed personal enrollment details without enabling approval', async () => {
    api.getAgentEnrollment.mockResolvedValue({
      id: 'intent-1',
      agentId: 'identity-1',
      nickname: 'Build Agent',
      username: 'build-agent',
      runtime: 'codex',
      kind: 'additional_host',
      homeSpace: { type: 'personal', userId: 'user-1' },
      status: 'approved',
      expiresAt: '2026-08-01T00:10:00.000Z',
      decidedAt: '2026-08-01T00:01:00.000Z',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:01:00.000Z',
    })
    render(<AgentIdentityApproval />)

    expect(await screen.findByText('Personal account')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Authorize' }).hasAttribute('disabled')).toBe(true)
  })

  it('surfaces load and approval errors from Error and unknown failures', async () => {
    api.getAgentEnrollment.mockRejectedValue(new Error('Enrollment expired'))
    render(<AgentIdentityApproval />)
    expect(await screen.findByText('Enrollment expired')).toBeTruthy()
    cleanup()

    api.getAgentEnrollment.mockRejectedValue('offline')
    render(<AgentIdentityApproval />)
    expect(await screen.findByText('Unable to load Agent enrollment.')).toBeTruthy()
    cleanup()

    api.getAgentEnrollment.mockResolvedValue({
      id: 'intent-1',
      agentId: null,
      nickname: 'Build Agent',
      username: 'build-agent',
      runtime: 'codex',
      kind: 'new_identity',
      homeSpace: { type: 'personal', userId: 'user-1' },
      status: 'pending',
      expiresAt: '2026-08-01T00:10:00.000Z',
      decidedAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    })
    api.approveAgentEnrollment.mockRejectedValue(new Error('Approval failed'))
    render(<AgentIdentityApproval />)
    fireEvent.click(await screen.findByRole('button', { name: 'Authorize' }))
    expect(await screen.findByText('Approval failed')).toBeTruthy()
    cleanup()

    api.approveAgentEnrollment.mockRejectedValue('offline')
    render(<AgentIdentityApproval />)
    fireEvent.click(await screen.findByRole('button', { name: 'Authorize' }))
    expect(await screen.findByText('Unable to approve Agent enrollment.')).toBeTruthy()
  })

  it('ignores enrollment completion after the approval page unmounts', async () => {
    let resolveIntent!: (value: unknown) => void
    const intentPromise = new Promise((resolve) => {
      resolveIntent = resolve
    })
    api.getAgentEnrollment.mockReturnValue(intentPromise)

    const view = render(<AgentIdentityApproval />)
    view.unmount()
    resolveIntent({
      id: 'intent-1',
      agentId: null,
      nickname: 'Build Agent',
      username: 'build-agent',
      runtime: 'codex',
      kind: 'new_identity',
      homeSpace: { type: 'personal', userId: 'user-1' },
      status: 'pending',
      expiresAt: '2026-08-01T00:10:00.000Z',
      decidedAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    })
    await intentPromise
  })

  it('ignores enrollment failure after the approval page unmounts', async () => {
    let rejectIntent!: (reason: unknown) => void
    const intentPromise = new Promise((_, reject) => {
      rejectIntent = reject
    })
    api.getAgentEnrollment.mockReturnValue(intentPromise)

    const view = render(<AgentIdentityApproval />)
    view.unmount()
    rejectIntent(new Error('Enrollment expired'))
    await expect(intentPromise).rejects.toThrow('Enrollment expired')
  })

  it('approves first protocol enrollment on the unified page [spec: account-center/agent-approval]', async () => {
    window.history.pushState(null, '', '/agent/enrollment?agent_id=protocol-agent-1&code=ABCD-1234')
    render(<AgentIdentityApproval />)

    expect(screen.getByRole('heading', { name: 'Approve Agent enrollment' })).toBeTruthy()
    expect(await screen.findByText('Codex')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Authorize' }))

    await waitFor(() =>
      expect(protocolApi.decideProtocolAgentEnrollment).toHaveBeenCalledWith({
        agentId: 'protocol-agent-1',
        userCode: 'ABCD-1234',
        action: 'approve',
      }),
    )
    expect(await screen.findByRole('heading', { name: 'Agent enrollment approved.' })).toBeTruthy()
  })

  it('denies first protocol enrollment on the unified page [spec: agent-identity/agent-enrollment-denial]', async () => {
    window.history.pushState(null, '', '/agent/enrollment?agent_id=protocol-agent-1&code=ABCD-1234')
    render(<AgentIdentityApproval />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(protocolApi.decideProtocolAgentEnrollment).toHaveBeenCalledWith({
        agentId: 'protocol-agent-1',
        userCode: 'ABCD-1234',
        action: 'deny',
      }),
    )
    expect(await screen.findByRole('heading', { name: 'Agent enrollment denied.' })).toBeTruthy()
  })
})
