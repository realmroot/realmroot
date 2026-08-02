import { createFileRoute } from '@tanstack/react-router'
import { AgentDetailPage } from '@/features/console/pages/agent-detail-page'

export const Route = createFileRoute('/console/agents/$agentId/settings')({ component: AgentSettingsRoute })

function AgentSettingsRoute() {
  const { agentId } = Route.useParams()
  return <AgentDetailPage agentId={agentId} section="settings" />
}
