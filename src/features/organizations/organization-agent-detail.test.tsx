import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { OrganizationAgentDetailPage } from '@/features/organizations/organization-agent-detail'

vi.mock('@/features/account/account-center', () => ({
  AccountOrganizationDetailPage: ({
    content,
    organizationId,
    section,
  }: {
    content: ReactNode
    organizationId: string
    section: string
  }) => (
    <div data-organization={organizationId} data-section={section}>
      {content}
    </div>
  ),
}))

vi.mock('@/features/agents/management-agent-detail', () => ({
  AgentDetailPage: ({ agentId, organizationId, section }: Record<string, string>) => (
    <span>{`${organizationId}:${agentId}:${section}`}</span>
  ),
}))

describe('Organization Agent detail', () => {
  it('binds Agent detail to the route Organization', () => {
    render(<OrganizationAgentDetailPage agentId="agent-1" organizationId="org-1" section="activity" />)

    expect(screen.getByText('org-1:agent-1:activity')).toBeTruthy()
    expect(screen.getByText('org-1:agent-1:activity').parentElement?.dataset).toMatchObject({
      organization: 'org-1',
      section: 'agents',
    })
  })
})
