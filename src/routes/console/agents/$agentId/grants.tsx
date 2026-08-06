import { createFileRoute } from '@tanstack/react-router'
import { AgentDetailPage } from '@/features/agents/management-agent-detail'

export const Route = createFileRoute('/console/agents/$agentId/grants')({ component: AgentGrantsRoute })

function AgentGrantsRoute() {
  const { agentId } = Route.useParams()
  return <AgentDetailPage agentId={agentId} section="grants" />
}
