import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import type { AgentDetailSection } from '@/features/console/pages/agent-detail-page'
import { AgentDetailPage } from '@/features/console/pages/agent-detail-page'
import { ConsoleScopeProvider } from '@/lib/console-context'

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
    <ConsoleScopeProvider value={{ organizationId, realmOperator: false }}>
      <AccountOrganizationDetailPage
        content={<AgentDetailPage agentId={agentId} section={section} />}
        organizationId={organizationId}
        section="agents"
      />
    </ConsoleScopeProvider>
  )
}
