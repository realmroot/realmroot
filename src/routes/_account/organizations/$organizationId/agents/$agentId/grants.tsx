import { createFileRoute } from '@tanstack/react-router'
import { OrganizationAgentDetailPage } from '@/features/organizations/organization-agent-detail'

export const Route = createFileRoute('/_account/organizations/$organizationId/agents/$agentId/grants')({
  component: OrganizationAgentGrantsRoute,
})

function OrganizationAgentGrantsRoute() {
  const { agentId, organizationId } = Route.useParams()
  return <OrganizationAgentDetailPage agentId={agentId} organizationId={organizationId} section="grants" />
}
