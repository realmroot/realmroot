import { createFileRoute } from '@tanstack/react-router'
import { OrganizationAgentDetailPage } from '@/features/organizations/organization-agent-detail'

export const Route = createFileRoute('/organizations/$organizationId/agents/$agentId/requests')({
  component: OrganizationAgentRequestsRoute,
})

function OrganizationAgentRequestsRoute() {
  const { agentId, organizationId } = Route.useParams()
  return <OrganizationAgentDetailPage agentId={agentId} organizationId={organizationId} section="requests" />
}
