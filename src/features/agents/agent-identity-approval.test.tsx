import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentIdentityApproval } from '@/features/agents/agent-identity-approval'

const api = vi.hoisted(() => ({
  approveAgentEnrollmentIntent: vi.fn(),
  getAgentEnrollmentIntent: vi.fn(),
}))

vi.mock('@/lib/api/account', () => api)

describe('Agent stable identity approval', () => {
  afterEach(cleanup)

  beforeEach(() => {
    window.history.pushState(null, '', '/agent/identity/approve?intent_id=intent-1')
    api.getAgentEnrollmentIntent.mockResolvedValue({
      id: 'intent-1',
      agentIdentityId: null,
      requestedName: 'Build Agent',
      homeSpace: { type: 'personal', userId: 'user-1' },
      protocolAgentId: 'protocol-agent-1',
      status: 'pending',
      expiresAt: '2026-08-01T00:10:00.000Z',
      approvedAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    })
    api.approveAgentEnrollmentIntent.mockResolvedValue({
      identity: {
        id: 'identity-1',
        issuer: 'https://auth.example.com',
        subject: 'agt_1',
        name: 'Build Agent',
        homeSpace: { type: 'personal', userId: 'user-1' },
        status: 'active',
        retiredAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        bindings: [],
      },
    })
  })

  it('approves an Agent-initiated stable identity enrollment [spec: agent-identity/agent-identity-enrollment]', async () => {
    render(<AgentIdentityApproval />)

    expect(await screen.findByText('Build Agent')).toBeTruthy()
    expect(screen.getByText('protocol-agent-1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve stable identity' }))

    await waitFor(() => expect(api.approveAgentEnrollmentIntent).toHaveBeenCalledWith('intent-1'))
    expect(await screen.findByText(/Agent identity approved: https:\/\/auth\.example\.com · agt_1/)).toBeTruthy()
  })

  it('does not approve without an enrollment intent id', () => {
    window.history.pushState(null, '', '/agent/identity/approve')
    render(<AgentIdentityApproval />)

    expect(screen.getByText('Missing enrollment intent.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve stable identity' }).hasAttribute('disabled')).toBe(true)
  })

  it('renders organization and completed enrollment details without enabling approval', async () => {
    api.getAgentEnrollmentIntent.mockResolvedValue({
      id: 'intent-1',
      agentIdentityId: 'identity-1',
      requestedName: null,
      homeSpace: { type: 'organization', organizationId: 'org-1' },
      protocolAgentId: 'protocol-agent-1',
      status: 'approved',
      expiresAt: '2026-08-01T00:10:00.000Z',
      approvedAt: '2026-08-01T00:01:00.000Z',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:01:00.000Z',
    })
    render(<AgentIdentityApproval />)

    expect(await screen.findByText('Organization · org-1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve stable identity' }).hasAttribute('disabled')).toBe(true)
  })

  it('surfaces load and approval errors from Error and unknown failures', async () => {
    api.getAgentEnrollmentIntent.mockRejectedValue(new Error('Enrollment expired'))
    render(<AgentIdentityApproval />)
    expect(await screen.findByText('Enrollment expired')).toBeTruthy()
    cleanup()

    api.getAgentEnrollmentIntent.mockRejectedValue('offline')
    render(<AgentIdentityApproval />)
    expect(await screen.findByText('Unable to load Agent enrollment.')).toBeTruthy()
    cleanup()

    api.getAgentEnrollmentIntent.mockResolvedValue({
      id: 'intent-1',
      agentIdentityId: null,
      requestedName: 'Build Agent',
      homeSpace: { type: 'personal', userId: 'user-1' },
      protocolAgentId: 'protocol-agent-1',
      status: 'pending',
      expiresAt: '2026-08-01T00:10:00.000Z',
      approvedAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    })
    api.approveAgentEnrollmentIntent.mockRejectedValue(new Error('Approval failed'))
    render(<AgentIdentityApproval />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve stable identity' }))
    expect(await screen.findByText('Approval failed')).toBeTruthy()
    cleanup()

    api.approveAgentEnrollmentIntent.mockRejectedValue('offline')
    render(<AgentIdentityApproval />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve stable identity' }))
    expect(await screen.findByText('Unable to approve Agent identity.')).toBeTruthy()
  })

  it('ignores enrollment completion after the approval page unmounts', async () => {
    let resolveIntent!: (value: unknown) => void
    const intentPromise = new Promise((resolve) => {
      resolveIntent = resolve
    })
    api.getAgentEnrollmentIntent.mockReturnValue(intentPromise)

    const view = render(<AgentIdentityApproval />)
    view.unmount()
    resolveIntent({
      id: 'intent-1',
      agentIdentityId: null,
      requestedName: 'Build Agent',
      homeSpace: { type: 'personal', userId: 'user-1' },
      protocolAgentId: 'protocol-agent-1',
      status: 'pending',
      expiresAt: '2026-08-01T00:10:00.000Z',
      approvedAt: null,
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
    api.getAgentEnrollmentIntent.mockReturnValue(intentPromise)

    const view = render(<AgentIdentityApproval />)
    view.unmount()
    rejectIntent(new Error('Enrollment expired'))
    await expect(intentPromise).rejects.toThrow('Enrollment expired')
  })
})
