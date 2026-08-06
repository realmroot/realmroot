import { createFileRoute } from '@tanstack/react-router'
import { OrganizationAgentDetailPage } from '@/features/organizations/organization-agent-detail'

export const Route = createFileRoute('/organizations/$organizationId/agents/$agentId/overview')({
  component: OrganizationAgentOverviewRoute,
})

function OrganizationAgentOverviewRoute() {
  const { agentId, organizationId } = Route.useParams()
  return <OrganizationAgentDetailPage agentId={agentId} organizationId={organizationId} section="overview" />
}
