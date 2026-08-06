import { createFileRoute } from '@tanstack/react-router'
import { AgentDetailPage } from '@/features/agents/management-agent-detail'

export const Route = createFileRoute('/console/agents/$agentId/requests')({ component: AgentRequestsRoute })

function AgentRequestsRoute() {
  const { agentId } = Route.useParams()
  return <AgentDetailPage agentId={agentId} section="requests" />
}
