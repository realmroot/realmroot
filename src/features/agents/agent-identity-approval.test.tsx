import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentIdentityApproval } from '@/features/agents/agent-identity-approval'

const api = vi.hoisted(() => ({
  approveAgentEnrollment: vi.fn(),
  getAgentEnrollment: vi.fn(),
}))

vi.mock('@/lib/api/account', () => api)

describe('Agent stable identity approval', () => {
  afterEach(cleanup)

  beforeEach(() => {
    window.history.pushState(null, '', '/agent/enrollments/approve?intent_id=intent-1')
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
  })

  it('approves an Agent-initiated stable identity enrollment [spec: agent-identity/agent-identity-enrollment]', async () => {
    render(<AgentIdentityApproval />)

    expect(await screen.findByText('Build Agent')).toBeTruthy()
    expect(screen.getByText('Personal account')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve Agent identity' }))

    await waitFor(() => expect(api.approveAgentEnrollment).toHaveBeenCalledWith('intent-1'))
    expect(await screen.findByText('Build Agent is ready on this host.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Agent enrollment approved.' })).toBeTruthy()
  })

  it('does not approve without an enrollment intent id', () => {
    window.history.pushState(null, '', '/agent/enrollments/approve')
    render(<AgentIdentityApproval />)

    expect(screen.getByRole('heading', { name: 'Agent enrollment unavailable.' })).toBeTruthy()
    expect(screen.getByText('This Agent enrollment request is incomplete.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders organization and completed enrollment details without enabling approval', async () => {
    api.getAgentEnrollment.mockResolvedValue({
      id: 'intent-1',
      agentId: 'identity-1',
      nickname: 'Build Agent',
      username: 'build-agent',
      runtime: 'codex',
      kind: 'additional_host',
      homeSpace: { type: 'organization', organizationId: 'org-1' },
      status: 'approved',
      expiresAt: '2026-08-01T00:10:00.000Z',
      decidedAt: '2026-08-01T00:01:00.000Z',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:01:00.000Z',
    })
    render(<AgentIdentityApproval />)

    expect(await screen.findByText('Organization')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add trusted host' }).hasAttribute('disabled')).toBe(true)
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
    fireEvent.click(await screen.findByRole('button', { name: 'Approve Agent identity' }))
    expect(await screen.findByText('Approval failed')).toBeTruthy()
    cleanup()

    api.approveAgentEnrollment.mockRejectedValue('offline')
    render(<AgentIdentityApproval />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve Agent identity' }))
    expect(await screen.findByText('Unable to approve Agent identity.')).toBeTruthy()
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
})
