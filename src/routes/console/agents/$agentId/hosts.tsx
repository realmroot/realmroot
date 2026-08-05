import { createFileRoute } from '@tanstack/react-router'
import { AgentDetailPage } from '@/features/agents/management-agent-detail'

export const Route = createFileRoute('/console/agents/$agentId/hosts')({ component: AgentHostsRoute })

function AgentHostsRoute() {
  const { agentId } = Route.useParams()
  return <AgentDetailPage agentId={agentId} section="hosts" />
}
