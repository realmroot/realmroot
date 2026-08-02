import { createFileRoute } from '@tanstack/react-router'
import { AgentDetailPage } from '@/features/console/pages/agent-detail-page'

export const Route = createFileRoute('/console/agents/$agentId/overview')({ component: AgentOverviewRoute })

function AgentOverviewRoute() {
  const { agentId } = Route.useParams()
  return <AgentDetailPage agentId={agentId} section="overview" />
}
