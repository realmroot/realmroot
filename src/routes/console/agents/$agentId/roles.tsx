import { createFileRoute } from '@tanstack/react-router'
import { AgentDetailPage } from '@/features/console/pages/agent-detail-page'

export const Route = createFileRoute('/console/agents/$agentId/roles')({ component: AgentRolesRoute })

function AgentRolesRoute() {
  const { agentId } = Route.useParams()
  return <AgentDetailPage agentId={agentId} section="roles" />
}
