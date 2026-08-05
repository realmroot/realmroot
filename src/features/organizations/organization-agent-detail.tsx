import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import type { AgentDetailSection } from '@/features/agents/management-agent-detail'
import { AgentDetailPage } from '@/features/agents/management-agent-detail'

export function OrganizationAgentDetailPage({
  agentId,
  organizationId,
  section,
}: {
  agentId: string
  organizationId: string
  section: AgentDetailSection
}) {
  return (
    <AccountOrganizationDetailPage
      content={<AgentDetailPage agentId={agentId} organizationId={organizationId} section={section} />}
      organizationId={organizationId}
      section="agents"
    />
  )
}
